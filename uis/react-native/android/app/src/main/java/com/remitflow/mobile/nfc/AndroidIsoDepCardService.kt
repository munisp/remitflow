package com.remitflow.mobile.nfc

import android.nfc.tech.IsoDep
import net.sf.scuba.smartcards.CardService
import net.sf.scuba.smartcards.CardServiceException
import net.sf.scuba.smartcards.CommandAPDU
import net.sf.scuba.smartcards.ResponseAPDU

/**
 * Minimal SCUBA CardService over android.nfc.tech.IsoDep.
 *
 * jmrtd 0.8.3 pulls in scuba-smartcards (JVM artifact), which does NOT ship
 * an Android IsoDep adapter (that lives in the separate scuba-sc-android
 * AAR, LGPL). To keep the dependency footprint to exactly the sanctioned
 * org.jmrtd:jmrtd:0.8.3, we implement the handful of CardService abstract
 * methods ourselves here — this is our code, not a modification of JMRTD or
 * SCUBA.
 */
class AndroidIsoDepCardService(private val isoDep: IsoDep) : CardService() {

    @Volatile
    private var opened = false

    override fun open() {
        if (opened) return
        if (!isoDep.isConnected) {
            isoDep.connect()
        }
        opened = true
    }

    override fun isOpen(): Boolean = opened && isoDep.isConnected

    /** Historical bytes of the ISO 14443-4 tag serve as the pseudo-ATR. */
    override fun getATR(): ByteArray? = isoDep.historicalBytes

    override fun transmit(commandAPDU: CommandAPDU): ResponseAPDU {
        try {
            val response = isoDep.transceive(commandAPDU.bytes)
                ?: throw CardServiceException("null response from IsoDep.transceive")
            return ResponseAPDU(response)
        } catch (e: CardServiceException) {
            throw e
        } catch (e: Exception) {
            throw CardServiceException("IsoDep transceive failed: ${e.message}")
        }
    }

    override fun isExtendedAPDULengthSupported(): Boolean {
        return try {
            // Requires API 26+; app minSdk is 24.
            android.os.Build.VERSION.SDK_INT >= 26 && isoDep.isExtendedLengthApduSupported
        } catch (e: Exception) {
            false
        }
    }

    override fun isConnectionLost(e: Exception?): Boolean {
        val message = e?.message ?: return !isoDep.isConnected
        if (message.contains("Tag was lost", ignoreCase = true) ||
            message.contains("tag lost", ignoreCase = true)
        ) {
            opened = false
            return true
        }
        return !isoDep.isConnected
    }

    override fun close() {
        opened = false
        try {
            if (isoDep.isConnected) isoDep.close()
        } catch (_: Exception) {
            // Closing a lost tag throws; nothing to recover here.
        }
    }
}
