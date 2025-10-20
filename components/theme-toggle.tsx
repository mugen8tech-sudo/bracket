"use client";

import { useEffect, useState } from "react";

const STORAGE_KEY = "theme"; // 'dark' | 'light'

function applyTheme(isDark: boolean) {
  const root = document.documentElement;
  if (isDark) root.classList.add("dark");
  else root.classList.remove("dark");
}

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  // Init: ambil dari localStorage atau fallback ke OS preference
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const initial = saved ? saved === "dark" : prefersDark;
    setIsDark(initial);
    applyTheme(initial);

    // Sinkronisasi jika user mengubah tema OS (hanya bila tidak ada preferensi tersimpan)
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => {
      if (!localStorage.getItem(STORAGE_KEY)) {
        setIsDark(e.matches);
        applyTheme(e.matches);
      }
    };
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  const toggle = () => {
    setIsDark((prev) => {
      const next = !prev;
      applyTheme(next);
      localStorage.setItem(STORAGE_KEY, next ? "dark" : "light");
      return next;
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className="rounded border px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-slate-800"
    >
      {isDark ? "🌙" : "☀️"}
    </button>
  );
}
