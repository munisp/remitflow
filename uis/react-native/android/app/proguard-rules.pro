# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# Add any project specific keep options here:

# SPEC-wave15 §9: NFC e-passport reading (JMRTD + SCUBA + BouncyCastle).
# Release builds run R8 full minification; the crypto provider and LDS/ASN.1
# parsers use reflection-adjacent patterns and must not be renamed/stripped.
-keep class org.jmrtd.** { *; }
-keep class net.sf.scuba.** { *; }
-keep class org.bouncycastle.** { *; }
-keep class org.ejbca.** { *; }
-dontwarn org.bouncycastle.**
-dontwarn org.ejbca.**
-dontwarn java.nio.**
-dontwarn org.codehaus.**
