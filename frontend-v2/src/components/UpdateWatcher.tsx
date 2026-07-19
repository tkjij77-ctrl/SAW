import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

const currentBuild = import.meta.env.VITE_BUILD_SHA ?? "development";

export function UpdateWatcher() {
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    if (currentBuild === "development") return;
    const check = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}version.json?t=${Date.now()}`, {
          cache: "no-store",
        });
        const data = await response.json();
        if (data.sha && data.sha !== currentBuild) setAvailable(true);
      } catch {
        // A failed update check must never interrupt the panel.
      }
    };
    void check();
    const timer = window.setInterval(check, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!available) return null;
  return (
    <div className="update-banner" role="status">
      <span>يتوفر تحديث جديد للوحة التحكم.</span>
      <button onClick={() => window.location.reload()}>
        <RefreshCw size={14} /> تحديث الآن
      </button>
    </div>
  );
}
