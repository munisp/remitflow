import React, { useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, Image } from 'react-native';
import { useAppDispatch, useAppSelector } from '../../store';
import { fetchProducts } from '../../store/slices/productSlice';

export const ProductListScreen = ({ navigation }: any) => {
  const dispatch = useAppDispatch();
  const { products } = useAppSelector(s => s.product);
  
  useEffect(() => { dispatch(fetchProducts({})); }, []);
  
  return (
    <View style={{flex:1,backgroundColor:'#f5f5f5'}}>
      <FlatList
        data={products}
        keyExtractor={i => i.id}
        renderItem={({item}) => (
          <TouchableOpacity style={{flexDirection:'row',backgroundColor:'#fff',padding:15,marginHorizontal:15,marginVertical:8,borderRadius:10}} onPress={() => navigation.navigate('ProductDetail', {id:item.id})}>
            <View style={{width:80,height:80,backgroundColor:'#eee',borderRadius:8,marginRight:15}} />
            <View style={{flex:1}}>
              <Text style={{fontSize:16,fontWeight:'600',marginBottom:4}}>{item.name}</Text>
              <Text style={{fontSize:14,color:'#666',marginBottom:8}}>{item.category}</Text>
              <Text style={{fontSize:18,fontWeight:'bold',color:'#667eea'}}>${item.price}</Text>
            </View>
          </TouchableOpacity>
        )}
      />
    </View>
  );
};