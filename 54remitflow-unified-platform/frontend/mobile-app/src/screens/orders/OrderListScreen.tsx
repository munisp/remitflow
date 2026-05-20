import React, { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchOrders } from '../../store/slices/orderSlice';

export const OrderListScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const { orders } = useAppSelector(s => s.order);
  
  useEffect(() => { dispatch(fetchOrders({})); }, []);
  
  return (
    <View style={{flex:1,backgroundColor:'#f5f5f5'}}>
      <FlatList
        data={orders}
        keyExtractor={i => i.id}
        renderItem={({item}) => (
          <TouchableOpacity style={{backgroundColor:'#fff',padding:15,marginHorizontal:15,marginVertical:8,borderRadius:10}} onPress={() => navigation.navigate('OrderDetail', {id:item.id})}>
            <View style={{flexDirection:'row',justifyContent:'space-between',marginBottom:8}}>
              <Text style={{fontSize:16,fontWeight:'600'}}>Order #{item.orderNumber}</Text>
              <Text style={{fontSize:16,fontWeight:'bold',color:'#10b981'}}>${item.totalAmount}</Text>
            </View>
            <Text style={{fontSize:14,color:'#666',marginBottom:8}}>{item.customerName}</Text>
            <View style={{flexDirection:'row',justifyContent:'space-between'}}>
              <Text style={{fontSize:12,color:'#999'}}>{item.items?.length || 0} items</Text>
              <View style={{paddingHorizontal:10,paddingVertical:4,borderRadius:12,backgroundColor:'#d1fae5'}}>
                <Text style={{fontSize:11,fontWeight:'600',textTransform:'uppercase'}}>{item.status}</Text>
              </View>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};