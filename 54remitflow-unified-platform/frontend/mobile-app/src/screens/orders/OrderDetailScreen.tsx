import React, { useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchOrderById } from '../../store/slices/orderSlice';

export const OrderDetailScreen = ({ route }: any) => {
  const { id } = route.params;
  const dispatch = useAppDispatch();
  const { currentOrder } = useAppSelector(s => s.order);
  
  useEffect(() => { dispatch(fetchOrderById(id)); }, [id]);
  
  if (!currentOrder) return null;
  
  return (
    <ScrollView style={{flex:1,backgroundColor:'#f5f5f5'}}>
      <View style={{backgroundColor:'#fff',padding:20,marginBottom:15}}>
        <Text style={{fontSize:24,fontWeight:'bold',marginBottom:10}}>Order #{currentOrder.orderNumber}</Text>
        <Text style={{fontSize:14,color:'#666'}}>Customer: {currentOrder.customerName}</Text>
      </View>
      <View style={{backgroundColor:'#fff',padding:20}}>
        <Text style={{fontSize:18,fontWeight:'600',marginBottom:15}}>Items</Text>
        {currentOrder.items?.map((item: any, i: number) => (
          <View key={i} style={{flexDirection:'row',justifyContent:'space-between',marginBottom:12}}>
            <Text>{item.productName} x{item.quantity}</Text>
            <Text style={{fontWeight:'600'}}>${item.subtotal}</Text>
          </View>
        ))}
        <View style={{borderTopWidth:1,borderTopColor:'#eee',marginTop:15,paddingTop:15,flexDirection:'row',justifyContent:'space-between'}}>
          <Text style={{fontSize:18,fontWeight:'bold'}}>Total</Text>
          <Text style={{fontSize:18,fontWeight:'bold',color:'#667eea'}}>${currentOrder.totalAmount}</Text>
        </View>
      </View>
    </ScrollView>
  );
};