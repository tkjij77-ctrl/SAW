import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { PageLoading } from "../components/ui/PageState";

export function ProtectedRoute() {
  const { loading, session, profile } = useAuth();
  const location = useLocation();
  if (loading) return <PageLoading label="جارٍ التحقق من الجلسة..." />;
  if (!session) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (profile?.username_completed === false && location.pathname !== "/account/choose-username") {
    return <Navigate to="/account/choose-username" replace />;
  }
  return <Outlet />;
}
