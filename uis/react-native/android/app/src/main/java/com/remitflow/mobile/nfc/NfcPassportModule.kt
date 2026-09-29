package com.remitflow.mobile.nfc

import android.nfc.NfcAdapter
import android.nfc.Tag
import android.nfc.tech.IsoDep
import android.os.Handler
import android.os.Looper
import android.util.Base64
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.LifecycleEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import net.sf.scuba.smartcards.CardService
import net.sf.scuba.smartcards.CardServiceException
import org.jmrtd.BACKey
import org.jmrtd.PassportService
import org.jmrtd.lds.SODFile
import org.jmrtd.lds.icao.DG15File
import org.jmrtd.lds.icao.DG1File
import org.jmrtd.lds.icao.DG2File
import java.io.ByteArrayOutputStream
import java.security.SecureRandom
import java.security.interfaces.ECPublicKey
import java.util.concurrent.Executors

/**
 * SPEC-wave15 §9 — NFC e-passport (eMRTD) reader bridge.
 *
 * Performs BAC with MRZ-derived keys, reads DG1 (MRZ), DG2 (portrait),
 * SOD (security object) and, when present, DG15 and performs Active
 * Authentication via JMRTD's PassportService (org.jmrtd:jmrtd:0.8.3,
 * LGPL-3.0 — unmodified dependency, see THIRD-PARTY-NOTICES.md).
 *
 * JS contract (shared with the iOS bridge):
 *   NfcPassport.readPassport(documentNumber, dateOfBirthYYMMDD, dateOfExpiryYYMMDD)
 *     resolves { dg1, dg2Portrait, sod, aaSignature } (base64; aaSignature may be null)
 *     rejects  with code UNAVAILABLE | USER_CANCEL | READ_ERROR | BAC_FAILED
 *
 * FAIL CLOSED: any read/parse error rejects the promise; the JS layer and the
 * server route the session to manual_review. Nothing is silently skipped.
 */
class NfcPassportModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext), LifecycleEventListener {

    companion object {
        const val NAME = "NfcPassport"

        const val ERR_UNAVAILABLE = "UNAVAILABLE"
        const val ERR_USER_CANCEL = "USER_CANCEL"
        const val ERR_READ_ERROR = "READ_ERROR"
        const val ERR_BAC_FAILED = "BAC_FAILED"

        /** Time the device waits for a passport tag before failing closed. */
        const val READ_TIMEOUT_MS = 60_000L
    }

    private val executor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    /** Non-null while a read session is waiting for a tag / reading a chip. */
    @Volatile
    private var activeSession: ReadSession? = null

    private inner class ReadSession(
        val bacKey: BACKey,
        val promise: Promise,
    ) {
        @Volatile var settled = false
        @Volatile var cancelled = false

        /** Reader mode can fire onTagDiscovered repeatedly for one tag. */
        @Volatile var readingStarted = false

        val timeoutRunnable = Runnable {
            settle(null, ERR_READ_ERROR, "Timed out waiting for passport tag", null)
        }

        @Synchronized
        fun settle(result: com.facebook.react.bridge.WritableMap?, code: String?, message: String?, cause: Throwable?) {
            if (settled) return
            settled = true
            mainHandler.removeCallbacks(timeoutRunnable)
            disableReaderMode()
            activeSession = null
            if (result != null) {
                promise.resolve(result)
            } else {
                promise.reject(code ?: ERR_READ_ERROR, message ?: "NFC read failed", cause)
            }
        }
    }

    init {
        reactContext.addLifecycleEventListener(this)
    }

    override fun getName(): String = NAME

    override fun onHostResume() {}

    override fun onHostPause() {}

    override fun onHostDestroy() {
        failActiveSession(ERR_USER_CANCEL, "Host destroyed")
    }

    @ReactMethod
    fun readPassport(documentNumber: String, dateOfBirth: String, dateOfExpiry: String, promise: Promise) {
        val adapter = NfcAdapter.getDefaultAdapter(reactContext)
        if (adapter == null || !adapter.isEnabled) {
            promise.reject(ERR_UNAVAILABLE, "NFC is not available or not enabled on this device")
            return
        }
        val activity = currentActivity
        if (activity == null) {
            promise.reject(ERR_UNAVAILABLE, "No foreground activity for NFC reader mode")
            return
        }
        if (activeSession != null) {
            promise.reject(ERR_READ_ERROR, "A passport read is already in progress")
            return
        }
        val session = try {
            // BACKey validates MRZ field formats (doc number + YYMMDD dates).
            ReadSession(BACKey(documentNumber, dateOfBirth, dateOfExpiry), promise)
        } catch (e: IllegalArgumentException) {
            promise.reject(ERR_READ_ERROR, "Invalid MRZ fields: ${e.message}", e)
            return
        }

        activeSession = session
        val flags = NfcAdapter.FLAG_READER_NFC_A or
            NfcAdapter.FLAG_READER_NFC_B or
            NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK
        // Reader mode must be enabled from the UI thread.
        activity.runOnUiThread {
            try {
                adapter.enableReaderMode(activity, { tag -> onTagDiscovered(tag) }, flags, null)
            } catch (e: Exception) {
                session.settle(null, ERR_READ_ERROR, "Failed to enable NFC reader mode: ${e.message}", e)
            }
        }
        mainHandler.postDelayed(session.timeoutRunnable, READ_TIMEOUT_MS)
    }

    /** Cancels an in-flight read; the pending readPassport promise rejects USER_CANCEL. */
    @ReactMethod
    fun cancelRead(promise: Promise) {
        val session = activeSession
        if (session == null) {
            promise.resolve(false)
            return
        }
        session.cancelled = true
        failActiveSession(ERR_USER_CANCEL, "Cancelled by user")
        promise.resolve(true)
    }

    private fun onTagDiscovered(tag: Tag) {
        val session = activeSession ?: return
        if (session.settled || session.cancelled || session.readingStarted) return
        session.readingStarted = true
        executor.execute { readChip(tag, session) }
    }

    private fun readChip(tag: Tag, session: ReadSession) {
        var service: PassportService? = null
        try {
            val isoDep = IsoDep.get(tag)
                ?: throw CardServiceException("Tag does not expose IsoDep")
            isoDep.timeout = 10_000
            val cardService: CardService = AndroidIsoDepCardService(isoDep)
            service = PassportService(
                cardService,
                PassportService.NORMAL_MAX_TRANCEIVE_LENGTH,
                PassportService.DEFAULT_MAX_BLOCKSIZE,
                false, // isSFIEnabled — read via file IDs, not short file IDs
                true,  // shouldCheckMAC — enforce secure-messaging MAC checks
            )
            service.open()
            service.sendSelectApplet(false)

            if (session.cancelled) throw CancelledException()

            try {
                service.doBAC(session.bacKey)
            } catch (e: Exception) {
                // BAC failure almost always means wrong MRZ digits (or a
                // non-eMRTD card). Distinct code so the UI can re-prompt.
                throw BacFailedException(e)
            }

            val dg1Bytes = readDataGroup(service, PassportService.EF_DG1)
            DG1File(dg1Bytes.inputStream()) // structural parse check — fail closed on corrupt DG1

            if (session.cancelled) throw CancelledException()

            val dg2Bytes = readDataGroup(service, PassportService.EF_DG2)
            val portraitBytes = extractPortrait(dg2Bytes) ?: dg2Bytes

            val sodBytes = readDataGroup(service, PassportService.EF_SOD)
            val sodFile = SODFile(sodBytes.inputStream())

            // Optional DG15 + Active Authentication. Absence of DG15 (or an AA
            // failure) is NOT a read failure: many passports omit AA. The
            // server reports aaValid=false with an honest reason instead.
            var dg15Bytes: ByteArray? = null
            var aaSignature: ByteArray? = null
            var aaChallenge: ByteArray? = null
            try {
                dg15Bytes = readDataGroup(service, PassportService.EF_DG15)
                val dg15File = DG15File(dg15Bytes.inputStream())
                val challenge = ByteArray(8).also { SecureRandom().nextBytes(it) }
                val digestAlg = sodFile.digestAlgorithm // e.g. "SHA-256"
                val sigAlg = if (dg15File.publicKey is ECPublicKey) {
                    "SHA256withECDSA"
                } else {
                    "SHA256withRSA"
                }
                val aaResult = service.doAA(dg15File.publicKey, digestAlg, sigAlg, challenge)
                aaSignature = aaResult.response
                aaChallenge = challenge
            } catch (e: Exception) {
                dg15Bytes = null
                aaSignature = null
                aaChallenge = null
            }

            val map = Arguments.createMap().apply {
                putString("dg1", b64(dg1Bytes))
                putString("dg2Portrait", b64(portraitBytes))
                putString("sod", b64(sodBytes))
                putString("aaSignature", aaSignature?.let { b64(it) })
                // Extra fields beyond the minimal contract; the server accepts
                // them optionally and needs them to verify Active Auth.
                putString("dg15", dg15Bytes?.let { b64(it) })
                putString("aaChallenge", aaChallenge?.let { b64(it) })
                // Raw DG2 enables the server's SOD hash check for the portrait
                // data group (dg2Portrait alone cannot be hash-checked).
                putString("dg2", b64(dg2Bytes))
            }
            session.settle(map, null, null, null)
        } catch (e: CancelledException) {
            session.settle(null, ERR_USER_CANCEL, "Cancelled by user", null)
        } catch (e: BacFailedException) {
            session.settle(null, ERR_BAC_FAILED, "BAC failed — check document number / dates", e.cause)
        } catch (e: Exception) {
            if (session.cancelled) {
                session.settle(null, ERR_USER_CANCEL, "Cancelled by user", null)
            } else {
                session.settle(null, ERR_READ_ERROR, "NFC passport read failed: ${e.message}", e)
            }
        } finally {
            try {
                service?.close()
            } catch (_: Exception) {
            }
        }
    }

    private fun readDataGroup(service: PassportService, efId: Short): ByteArray {
        val input = service.getInputStream(efId)
        val out = ByteArrayOutputStream()
        val buf = ByteArray(4096)
        while (true) {
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
        }
        return out.toByteArray()
    }

    /** Extracts the first face image (JPEG / JPEG2000) from a raw DG2 file. */
    private fun extractPortrait(dg2Bytes: ByteArray): ByteArray? {
        return try {
            val dg2 = DG2File(dg2Bytes.inputStream())
            val imageInfo = dg2.faceInfos.firstOrNull()?.faceImageInfos?.firstOrNull()
                ?: return null
            val input = imageInfo.imageInputStream
            val out = ByteArrayOutputStream(imageInfo.imageLength.toInt().coerceAtLeast(0))
            val buf = ByteArray(4096)
            while (true) {
                val n = input.read(buf)
                if (n < 0) break
                out.write(buf, 0, n)
            }
            out.toByteArray()
        } catch (e: Exception) {
            null
        }
    }

    private fun failActiveSession(code: String, message: String) {
        activeSession?.cancelled = true
        activeSession?.settle(null, code, message, null)
    }

    private fun disableReaderMode() {
        mainHandler.post {
            try {
                val activity = currentActivity ?: return@post
                NfcAdapter.getDefaultAdapter(reactContext)?.disableReaderMode(activity)
            } catch (_: Exception) {
            }
        }
    }

    private fun b64(bytes: ByteArray): String = Base64.encodeToString(bytes, Base64.NO_WRAP)

    private class CancelledException : Exception()
    private class BacFailedException(cause: Throwable) : Exception(cause)
}
