import { lazy } from 'react';
import { RouteObject } from 'react-router-dom';
import ProtectedRoute from '../components/ProtectedRoute';
import AdminLayout from '../components/layouts/AdminLayout';

const AdminDashboard = lazy(() => import('../pages/admin/Dashboard'));
const AdminProducts = lazy(() => import('../pages/admin/Products'));
const StoreContentEditor = lazy(() => import('../pages/admin/StoreContentEditor'));
const PromoManager = lazy(() => import('../pages/admin/PromoManager'));
const PhotoBank = lazy(() => import('../pages/admin/PhotoBank'));
const Orders = lazy(() => import('../pages/admin/Orders'));
const GeminiChatbotPage = lazy(() => import('../pages/admin/GeminiChatbotPage'));

const adminRoutes: RouteObject[] = [
  {
    path: '/admin',
    element: (
      <ProtectedRoute requiredRole="admin">
        <AdminLayout>
          <></>
        </AdminLayout>
      </ProtectedRoute>
    ),
    children: [
      { index: true, element: <AdminDashboard /> },
      { path: 'products', element: <AdminProducts /> },
      { path: 'store-content', element: <StoreContentEditor /> },
      { path: 'photo-bank', element: <PhotoBank /> },
      { path: 'orders', element: <Orders /> },
      { path: 'promo-manager', element: <PromoManager /> },
      { path: 'gemini-assistant', element: <GeminiChatbotPage /> },
    ],
  },
];

export default adminRoutes;
