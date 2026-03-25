/**
 * src/components/NetworkStatusBanner.tsx
 *
 * Drops a banner at the top of the screen when the user is offline or
 * has a poor connection. Slides in smoothly, slides out when connection recovers.
 *
 * USAGE — add once inside AppLayout.tsx:
 *   import NetworkStatusBanner from "@/components/NetworkStatusBanner";
 *
 *   // Inside your AppLayout return, before children:
 *   <NetworkStatusBanner />
 *   {children}
 *
 * That's it. It handles everything internally.
 */

import { useEffect, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { WifiOff, Wifi } from "lucide-react";
import { useNetworkStatus } from "@/hooks/useNetworkStatus";
import { toast } from "sonner";

const NetworkStatusBanner = () => {
  const { status, isOffline, isPoor } = useNetworkStatus();
  const prevStatus = useRef<string>("good");
  const showBanner = isOffline || isPoor;

  // Also fire a toast when status changes so user notices
  // even if they're scrolled down and can't see the banner
  useEffect(() => {
    const prev = prevStatus.current;
    prevStatus.current = status;

    if (prev === status) return; // no change

    if (status === "offline") {
      toast.error("You're offline. Check your internet connection.", {
        id:       "network-offline",
        duration: Infinity, // stays until dismissed or connection returns
        icon:     "📵",
      });
    } else if (status === "poor") {
      toast.warning("Weak connection detected. Things may be slow.", {
        id:       "network-poor",
        duration: 6000,
        icon:     "📶",
      });
    } else if (prev !== "good") {
      // Connection recovered
      toast.dismiss("network-offline");
      toast.dismiss("network-poor");
      toast.success("Connection restored.", {
        id:       "network-restored",
        duration: 3000,
        icon:     "✅",
      });
    }
  }, [status]);

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          key="network-banner"
          initial={{ y: -60, opacity: 0 }}
          animate={{ y: 0,   opacity: 1 }}
          exit={{   y: -60, opacity: 0 }}
          transition={{ type: "spring", stiffness: 400, damping: 30 }}
          className={`
            fixed top-0 left-0 right-0 z-[9999]
            flex items-center justify-center gap-2.5
            px-4 py-2.5 text-sm font-medium
            ${isOffline
              ? "bg-destructive text-destructive-foreground"
              : "bg-warning text-warning-foreground"}
          `}
          role="alert"
          aria-live="assertive"
        >
          {isOffline ? (
            <>
              <WifiOff className="w-4 h-4 shrink-0" />
              <span>
                You're offline — please check your internet connection.
              </span>
            </>
          ) : (
            <>
              <Wifi className="w-4 h-4 shrink-0 opacity-60" />
              <span>
                Poor connection — actions may be slower than usual.
                Try moving to a better signal area.
              </span>
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default NetworkStatusBanner;