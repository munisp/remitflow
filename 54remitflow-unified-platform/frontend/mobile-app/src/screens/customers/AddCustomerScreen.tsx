import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, ScrollView, Alert } from 'react-native';
import { useAppDispatch } from '../../store';
import { addCustomer } from '../../store/slices/customerSlice';

export const AddCustomerScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const [form, setForm] = useState({ name: '', email: '', phone: '', address: '' });

  const handleSubmit = async () => {
    if (!form.name || !form.phone) {
      Alert.alert('Error', 'Name and phone are required');
      return;
    }
    try {
      await dispatch(addCustomer(form)).unwrap();
      Alert.alert('Success', 'Customer added', [{ text: 'OK', onPress: () => navigation.goBack() }]);
    } catch (error: any) {
      Alert.alert('Error', error.message);
    }
  };

  return (
    <ScrollView style={{flex:1,backgroundColor:'#f5f5f5',padding:20}}>
      <Text style={{fontSize:14,fontWeight:'600',marginTop:15,marginBottom:8}}>Name *</Text>
      <TextInput style={{backgroundColor:'#fff',borderWidth:1,borderColor:'#ddd',borderRadius:8,padding:15}} placeholder="Full name" value={form.name} onChangeText={text => setForm({...form, name:text})} />
      
      <Text style={{fontSize:14,fontWeight:'600',marginTop:15,marginBottom:8}}>Phone *</Text>
      <TextInput style={{backgroundColor:'#fff',borderWidth:1,borderColor:'#ddd',borderRadius:8,padding:15}} placeholder="Phone number" value={form.phone} onChangeText={text => setForm({...form, phone:text})} keyboardType="phone-pad" />
      
      <Text style={{fontSize:14,fontWeight:'600',marginTop:15,marginBottom:8}}>Email</Text>
      <TextInput style={{backgroundColor:'#fff',borderWidth:1,borderColor:'#ddd',borderRadius:8,padding:15}} placeholder="Email address" value={form.email} onChangeText={text => setForm({...form, email:text})} keyboardType="email-address" />
      
      <Text style={{fontSize:14,fontWeight:'600',marginTop:15,marginBottom:8}}>Address</Text>
      <TextInput style={{backgroundColor:'#fff',borderWidth:1,borderColor:'#ddd',borderRadius:8,padding:15,height:80}} placeholder="Full address" value={form.address} onChangeText={text => setForm({...form, address:text})} multiline />
      
      <TouchableOpacity style={{backgroundColor:'#667eea',padding:15,borderRadius:8,alignItems:'center',marginTop:30}} onPress={handleSubmit}>
        <Text style={{color:'#fff',fontSize:16,fontWeight:'600'}}>Add Customer</Text>
      </TouchableOpacity>
    </ScrollView>
  );
};