"use client";

import { useEffect, useState } from "react";
import { API, api } from "./api";

export function useWaStatus() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const data = await api("/api/whatsapp/status");
        if (alive) setStatus(data);
      } catch {
        // keep last known status
      }
    }
    load();
    const timer = setInterval(load, 2500);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  return status;
}

export function useLiveReload(onEvent) {
  useEffect(() => {
    const timer = setInterval(() => onEvent?.(), 3000);
    return () => clearInterval(timer);
  }, [onEvent]);
}

export function socketUrl() {
  return API.startsWith("http") ? API : undefined;
}
