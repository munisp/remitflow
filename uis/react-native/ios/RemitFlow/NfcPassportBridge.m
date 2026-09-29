//
//  NfcPassportBridge.m
//  RemitFlow
//
//  SPEC-wave15 §9 — ObjC bridge exposing the Swift NfcPassportModule to
//  React Native as NativeModules.NfcPassport.
//

#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(NfcPassport, NSObject)

RCT_EXTERN_METHOD(readPassport:(NSString *)documentNumber
                  dateOfBirth:(NSString *)dateOfBirth
                  dateOfExpiry:(NSString *)dateOfExpiry
                  resolver:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

RCT_EXTERN_METHOD(cancelRead:(RCTPromiseResolveBlock)resolve
                  rejecter:(RCTPromiseRejectBlock)reject)

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

@end
