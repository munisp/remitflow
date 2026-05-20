import React, { useState, useEffect } from 'react';
import { View, Text, Image, ScrollView, TouchableOpacity, StyleSheet } from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialIcons';

const ProductDetailScreen = () => {
  const route = useRoute();
  const navigation = useNavigation();
  const { productId } = route.params;
  const [product, setProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);

  useEffect(() => {
    fetchProductDetail();
  }, [productId]);

  const fetchProductDetail = async () => {
    try {
      const response = await fetch(`http://localhost:8000/api/products/${productId}`);
      const data = await response.json();
      setProduct(data);
    } catch (error) {
      console.error('Error fetching product:', error);
    }
  };

  const addToCart = () => {
    navigation.navigate('Cart', { product, quantity });
  };

  if (!product) return <View style={styles.loading}><Text>Loading...</Text></View>;

  return (
    <ScrollView style={styles.container}>
      <Image source={{ uri: product.image_url }} style={styles.productImage} />
      <View style={styles.content}>
        <Text style={styles.productName}>{product.name}</Text>
        <Text style={styles.productPrice}>KES {product.price.toLocaleString()}</Text>
        <Text style={styles.productDescription}>{product.description}</Text>
        
        <View style={styles.quantityContainer}>
          <Text style={styles.quantityLabel}>Quantity:</Text>
          <View style={styles.quantityControls}>
            <TouchableOpacity onPress={() => setQuantity(Math.max(1, quantity - 1))} style={styles.quantityButton}>
              <Icon name="remove" size={24} color="#fff" />
            </TouchableOpacity>
            <Text style={styles.quantityValue}>{quantity}</Text>
            <TouchableOpacity onPress={() => setQuantity(quantity + 1)} style={styles.quantityButton}>
              <Icon name="add" size={24} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.addToCartButton} onPress={addToCart}>
          <Text style={styles.addToCartText}>Add to Cart</Text>
        </TouchableOpacity>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  loading: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  productImage: { width: '100%', height: 300 },
  content: { padding: 20 },
  productName: { fontSize: 24, fontWeight: 'bold', marginBottom: 8 },
  productPrice: { fontSize: 20, color: '#2e7d32', fontWeight: 'bold', marginBottom: 16 },
  productDescription: { fontSize: 16, color: '#666', marginBottom: 24, lineHeight: 24 },
  quantityContainer: { marginBottom: 24 },
  quantityLabel: { fontSize: 16, fontWeight: '600', marginBottom: 12 },
  quantityControls: { flexDirection: 'row', alignItems: 'center' },
  quantityButton: { backgroundColor: '#1976d2', width: 40, height: 40, borderRadius: 20, justifyContent: 'center', alignItems: 'center' },
  quantityValue: { fontSize: 20, fontWeight: 'bold', marginHorizontal: 24 },
  addToCartButton: { backgroundColor: '#2e7d32', padding: 16, borderRadius: 8, alignItems: 'center' },
  addToCartText: { color: '#fff', fontSize: 18, fontWeight: 'bold' }
});

export default ProductDetailScreen;
