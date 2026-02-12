import { useState, useEffect } from "react";
import { Clock, AlertTriangle } from "lucide-react";

interface DisputeTimerProps {
  expiresAt: string;
  autoExecuteAt: string;
  status: string;
}

const DisputeTimer = ({ expiresAt, autoExecuteAt, status }: DisputeTimerProps) => {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  const getTimeLeft = (target: string) => {
    const diff = new Date(target).getTime() - now.getTime();
    if (diff <= 0) return { days: 0, hours: 0, minutes: 0, seconds: 0, expired: true };
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    const hours = Math.floor((diff / (1000 * 60 * 60)) % 24);
    const minutes = Math.floor((diff / (1000 * 60)) % 60);
    const seconds = Math.floor((diff / 1000) % 60);
    return { days, hours, minutes, seconds, expired: false };
  };

  const disputeExpiry = getTimeLeft(expiresAt);
  const autoExec = getTimeLeft(autoExecuteAt);

  const pad = (n: number) => n.toString().padStart(2, "0");

  if (status === "resolved") return null;

  return (
    <div className="space-y-3">
      {/* Auto-execute timer */}
      {!autoExec.expired && (
        <div className="bg-warning/10 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <Clock className="w-4 h-4 text-warning" />
            <span className="text-sm font-semibold text-foreground">Auto-execute in</span>
          </div>
          <div className="flex gap-2 justify-center">
            {[
              { value: autoExec.days, label: "Days" },
              { value: autoExec.hours, label: "Hrs" },
              { value: autoExec.minutes, label: "Min" },
              { value: autoExec.seconds, label: "Sec" },
            ].map((unit) => (
              <div key={unit.label} className="text-center">
                <div className="bg-warning/20 rounded-lg w-14 h-14 flex items-center justify-center">
                  <span className="font-display text-xl font-bold text-warning">{pad(unit.value)}</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1">{unit.label}</span>
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            If no response, the proposed action will be executed automatically
          </p>
        </div>
      )}

      {/* Dispute expiry timer */}
      <div className={`rounded-xl p-4 ${disputeExpiry.expired ? "bg-destructive/10" : "bg-primary/10"}`}>
        <div className="flex items-center gap-2 mb-2">
          {disputeExpiry.expired ? (
            <AlertTriangle className="w-4 h-4 text-destructive" />
          ) : (
            <Clock className="w-4 h-4 text-primary" />
          )}
          <span className="text-sm font-semibold text-foreground">
            {disputeExpiry.expired ? "Dispute expired — moved to admin" : "Dispute expires in"}
          </span>
        </div>
        {!disputeExpiry.expired && (
          <div className="flex gap-2 justify-center">
            {[
              { value: disputeExpiry.days, label: "Days" },
              { value: disputeExpiry.hours, label: "Hrs" },
              { value: disputeExpiry.minutes, label: "Min" },
              { value: disputeExpiry.seconds, label: "Sec" },
            ].map((unit) => (
              <div key={unit.label} className="text-center">
                <div className="bg-primary/10 rounded-lg w-14 h-14 flex items-center justify-center">
                  <span className="font-display text-xl font-bold text-primary">{pad(unit.value)}</span>
                </div>
                <span className="text-[10px] text-muted-foreground mt-1">{unit.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default DisputeTimer;
