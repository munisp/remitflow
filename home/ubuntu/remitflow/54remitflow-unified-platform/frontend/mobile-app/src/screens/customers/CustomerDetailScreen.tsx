import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchCustomerById } from '../../store/slices/customerSlice';

export const CustomerDetailScreen = ({ route, navigation }: any) => {
  const { id } = route.params;
  const dispatch = useAppDispatch();
  const { currentCustomer } = useAppSelector(state => state.customer);

  useEffect(() => {
    dispatch(fetchCustomerById(id));
  }, [id]);

  if (!currentCustomer) return null;

  return (
    <ScrollView style={{flex:1,backgroundColor:'#f5f5f5'}}>
      <View style={{backgroundColor:'#fff',padding:20,marginBottom:15}}>
        <View style={{width:80,height:80,borderRadius:40,backgroundColor:'#667eea',alignSelf:'center',justifyContent:'center',alignItems:'center',marginBottom:15}}>
          <Text style={{fontSize:32,color:'#fff',fontWeight:'bold'}}>{currentCustomer.name.charAt(0)}</Text>
        </View>
        <Text style={{fontSize:24,fontWeight:'bold',textAlign:'center',marginBottom:5}}>{currentCustomer.name}</Text>
        <Text style={{fontSize:14,color:'#666',textAlign:'center'}}>{currentCustomer.email}</Text>
      </View>
      <View style={{backgroundColor:'#fff',padding:20}}>
        <Text style={{fontSize:18,fontWeight:'600',marginBottom:15}}>Contact Information</Text>
        <Text style={{marginBottom:10}}>Phone: {currentCustomer.phone}</Text>
        <Text>Address: {currentCustomer.address || 'N/A'}</Text>
      </View>
    </ScrollView>
  );
};