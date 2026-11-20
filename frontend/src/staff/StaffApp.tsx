import { Navigate, Route, Routes } from 'react-router-dom';
import { homePathFor, useAuth } from '../shared/auth/store';

export default function StaffApp() {
  const { user } = useAuth();
  return (
    <Routes>
      <Route path="*" element={<Navigate to={homePathFor(user?.role)} replace />} />
    </Routes>
  );
}
