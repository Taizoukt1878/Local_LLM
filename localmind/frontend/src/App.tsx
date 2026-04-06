import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import Onboarding from "./pages/Onboarding";
import Chat from "./pages/Chat";
import ModelPicker from "./pages/ModelPicker";
import { getInstallStatus, getInstalledModels, waitForBackend } from "./api";


const ONBOARDING_KEY = "onboardingComplete";

export default function App() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [startupMessage, setStartupMessage] = useState("Starting LocalMind...");
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // On every launch: wait for the backend, then check Ollama + models to
  // decide whether to resume chat or restart onboarding.
  useEffect(() => {
    const checkOnLaunch = async () => {
      try {
        await waitForBackend(() => {
          setStartupMessage("Taking longer than usual to start, please wait...");
        });
      } catch {
        setFatalError("Please restart the app");
        setReady(true);
        return;
      }

      console.log('[launch] backend ready');

      let status: { installed: boolean; running: boolean };
      try {
        status = await getInstallStatus();
      } catch {
        console.log('[launch] routing to: onboarding (status check failed)');
        localStorage.removeItem(ONBOARDING_KEY);
        setOnboardingDone(false);
        setReady(true);
        return;
      }

      console.log('[launch] ollama status:', status);

      if (!status.installed) {
        console.log('[launch] routing to: onboarding (not installed)');
        localStorage.removeItem(ONBOARDING_KEY);
        setOnboardingDone(false);
        setReady(true);
        return;
      }

      let models: unknown[];
      try {
        models = await getInstalledModels();
      } catch {
        console.log('[launch] routing to: onboarding (models check failed)');
        localStorage.removeItem(ONBOARDING_KEY);
        setOnboardingDone(false);
        setReady(true);
        return;
      }

      console.log('[launch] models installed:', models);

      if ((models as unknown[]).length === 0) {
        console.log('[launch] routing to: onboarding (no models)');
        localStorage.removeItem(ONBOARDING_KEY);
        setOnboardingDone(false);
      } else {
        console.log('[launch] routing to: chat');
        setOnboardingDone(true);
      }

      setReady(true);
    };

    checkOnLaunch();
  }, []);

  const finishOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setOnboardingDone(true);
    navigate("/chat", { replace: true });
  };

  if (!ready) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-surface">
        <Loader2 size={32} className="text-accent animate-spin" />
        <p className="text-sm text-muted">{startupMessage}</p>
      </div>
    );
  }

  if (fatalError) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <p className="text-red-500 text-sm">{fatalError}</p>
      </div>
    );
  }

  return (
    <Routes>
      <Route
        path="/onboarding"
        element={<Onboarding onComplete={finishOnboarding} />}
      />
      <Route
        path="/chat"
        element={
          onboardingDone ? (
            <Chat darkMode={darkMode} onToggleDark={() => setDarkMode((d) => !d)} />
          ) : (
            <Navigate to="/onboarding" replace />
          )
        }
      />
      <Route
        path="/models"
        element={onboardingDone ? <ModelPicker /> : <Navigate to="/onboarding" replace />}
      />
      <Route
        path="*"
        element={<Navigate to={onboardingDone ? "/chat" : "/onboarding"} replace />}
      />
    </Routes>
  );
}
