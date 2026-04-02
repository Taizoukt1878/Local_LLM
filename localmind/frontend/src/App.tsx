import { Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { useState, useEffect } from "react";
import Onboarding from "./pages/Onboarding";
import Chat from "./pages/Chat";
import ModelPicker from "./pages/ModelPicker";

const ONBOARDING_KEY = "localmind_onboarding_done";

export default function App() {
  const navigate = useNavigate();
  const [onboardingDone, setOnboardingDone] = useState<boolean>(
    () => localStorage.getItem(ONBOARDING_KEY) === "true"
  );
  const [darkMode, setDarkMode] = useState(() => {
    // Apply dark class synchronously before first paint
    document.documentElement.classList.add("dark");
    return true;
  });

  useEffect(() => {
    document.documentElement.classList.toggle("dark", darkMode);
  }, [darkMode]);

  const finishOnboarding = () => {
    localStorage.setItem(ONBOARDING_KEY, "true");
    setOnboardingDone(true);
    navigate("/chat", { replace: true });
  };

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
        element={
          <Navigate to={onboardingDone ? "/chat" : "/onboarding"} replace />
        }
      />
    </Routes>
  );
}
