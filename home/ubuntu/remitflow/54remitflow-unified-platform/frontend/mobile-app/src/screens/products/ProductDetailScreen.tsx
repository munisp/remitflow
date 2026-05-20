import React, { useEffect } from 'react';
import { View, Text, ScrollView, TouchableOpacity, Image } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchProductById } from '../../store/slices/productSlice';

export const ProductDetailScreen = ({ route }: any) => {
  const { id } = route.params;
  const dispatch = useAppDispatch();
  const { currentProduct } = useAppSelector(s => s.product);
  
  useEffect(() => { dispatch(fetchProductById(id)); }, [id]);
  
  if (!currentProduct) return null;
  
  return (
    <ScrollView style={{flex:1,backgroundColor:'#fff'}}>
      <View style={{width:'100%',height:300,backgroundColor:'#eee'}} />
      <View style={{padding:20}}>
        <Text style={{fontSize:24,fontWeight:'bold',marginBottom:10}}>{currentProduct.name}</Text>
        <Text style={{fontSize:28,fontWeight:'bold',color:'#667eea',marginBottom:20}}>${currentProduct.price}</Text>
        <Text style={{fontSize:16,color:'#666',lineHeight:24}}>{currentProduct.description}</Text>
        <TouchableOpacity style={{backgroundColor:'#667eea',padding:15,borderRadius:8,marginTop:30}}>
          <Text style={{color:'#fff',fontSize:16,fontWeight:'600',textAlign:'center'}}>Add to Cart</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};