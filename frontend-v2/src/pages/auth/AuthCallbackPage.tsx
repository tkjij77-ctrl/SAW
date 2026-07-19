import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { PageLoading } from "../../components/ui/PageState";
import { supabase } from "../../lib/supabase";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  useEffect(() => {
    const finish = async () => {
      await supabase.auth.getSession();
      navigate("/overview", { replace: true });
    };
    void finish();
  }, [navigate]);
  return <PageLoading label="جارٍ إكمال تسجيل الدخول..." />;
}
