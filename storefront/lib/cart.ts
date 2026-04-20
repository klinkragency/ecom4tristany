import { api, ApiError } from './api';
import type { Cart } from './types';

export async function getCart(): Promise<Cart> {
  return api<Cart>('/api/storefront/cart');
}

export async function addToCart(variantId: string, quantity = 1): Promise<Cart> {
  return api<Cart>('/api/storefront/cart/items', {
    method: 'POST',
    body: JSON.stringify({ variantId, quantity }),
  });
}

export async function updateItem(itemId: string, quantity: number): Promise<Cart> {
  return api<Cart>(`/api/storefront/cart/items/${itemId}`, {
    method: 'PUT',
    body: JSON.stringify({ quantity }),
  });
}

export async function removeItem(itemId: string): Promise<Cart> {
  return api<Cart>(`/api/storefront/cart/items/${itemId}`, { method: 'DELETE' });
}

export async function clearCart(): Promise<Cart> {
  return api<Cart>('/api/storefront/cart/clear', { method: 'POST' });
}

export async function applyDiscount(code: string): Promise<Cart> {
  return api<Cart>('/api/storefront/cart/discount', {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export async function removeDiscount(): Promise<Cart> {
  return api<Cart>('/api/storefront/cart/discount', { method: 'DELETE' });
}

export { ApiError };
