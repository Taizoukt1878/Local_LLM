import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { Loader2 } from "lucide-react";
import Onboarding from "./pages/Onboarding";
import Chat from "./pages/Chat";
import ModelPicker from "./pages/ModelPicker";
import { getInstallStatus } from "./api";


const ONBOARDING_KEY = "localmind_onboarding_done";

export default function App() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [onboardingDone, setOnboardingDone] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  // On every launch: verify Ollama is actually still installed.
  // If the user previously completed onboarding but Ollama has since been
  // removed (e.g. fresh OS, new machine), send them back through the flow.
  useEffect(() => {
    const checkOnLaunch = async () => {
      const wasOnboarded = localStorage.getItem(ONBOARDING_KEY) === "true";

      if (!wasOnboarded) {
        setReady(true);
        return;
      }

      try {
        const status = await getInstallStatus();
        if (!status.installed) {
          localStorage.removeItem(ONBOARDING_KEY);
          setOnboardingDone(false);
        } else {
          setOnboardingDone(true);
        }
      } catch {
        // Backend isn't up yet — onboarding will surface the error gracefully.
        setOnboardingDone(false);
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
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <Loader2 size={32} className="text-accent animate-spin" />
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
