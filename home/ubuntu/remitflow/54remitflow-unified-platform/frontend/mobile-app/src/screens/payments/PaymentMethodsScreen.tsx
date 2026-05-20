import React from 'react';
import { View, Text, TouchableOpacity, ScrollView } from 'react-native';

const methods = [
  {id:'card',name:'Credit/Debit Card',icon:'💳'},
  {id:'bank',name:'Bank Transfer',icon:'🏦'},
  {id:'mobile',name:'Mobile Money',icon:'📱'},
  {id:'wallet',name:'Digital Wallet',icon:'👛'},
  {id:'qr',name:'QR Code',icon:'📷'},
];

export const PaymentMethodsScreen = ({ navigation }: any) => {
  return (
    <ScrollView style={{flex:1,backgroundColor:'#f5f5f5',padding:20}}>
      <Text style={{fontSize:24,fontWeight:'bold',marginBottom:20}}>Select Payment Method</Text>
      {methods.map(m => (
        <TouchableOpacity key={m.id} style={{flexDirection:'row',alignItems:'center',backgroundColor:'#fff',padding:20,marginBottom:15,borderRadius:10}}>
          <Text style={{fontSize:32,marginRight:15}}>{m.icon}</Text>
          <Text style={{fontSize:16,fontWeight:'600'}}>{m.name}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};