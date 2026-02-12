import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Camera, Upload, X, AlertTriangle, Clock, CheckCircle, XCircle, Image } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface DisputeFormProps {
  receiptAmount: number;
  onSubmit: (data: {
    reason: string;
    proposedAction: string;
    proposedAmount?: number;
    evidence: File[];
  }) => void;
  onCancel: () => void;
}

const DisputeForm = ({ receiptAmount, onSubmit, onCancel }: DisputeFormProps) => {
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<"release_specific" | "refund_full">("refund_full");
  const [proposedAmount, setProposedAmount] = useState("");
  const [evidence, setEvidence] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    setEvidence((prev) => [...prev, ...files]);
    const newPreviews = files.map((f) => URL.createObjectURL(f));
    setPreviews((prev) => [...prev, ...newPreviews]);
  };

  const removeFile = (index: number) => {
    setEvidence((prev) => prev.filter((_, i) => i !== index));
    URL.revokeObjectURL(previews[index]);
    setPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const getSpamFee = () => {
    if (receiptAmount < 50000) return 100;
    if (receiptAmount < 500000) return 200;
    return 300;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      reason,
      proposedAction: action,
      proposedAmount: action === "release_specific" ? parseFloat(proposedAmount) : undefined,
      evidence,
    });
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      onSubmit={handleSubmit}
      className="space-y-5"
    >
      <div className="bg-warning/10 rounded-xl p-4 flex gap-3">
        <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
        <div className="text-sm">
          <p className="font-semibold text-foreground">Starting a dispute</p>
          <p className="text-muted-foreground">A dispute fee of ₦{getSpamFee().toLocaleString()} will be charged to prevent abuse.</p>
        </div>
      </div>

      {/* Action selection */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">What do you want?</label>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setAction("refund_full")}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              action === "refund_full"
                ? "border-accent bg-accent/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <XCircle className={`w-5 h-5 mb-2 ${action === "refund_full" ? "text-accent" : "text-muted-foreground"}`} />
            <p className="font-semibold text-sm text-foreground">Full Refund</p>
            <p className="text-xs text-muted-foreground">Get all your money back</p>
          </button>
          <button
            type="button"
            onClick={() => setAction("release_specific")}
            className={`p-4 rounded-xl border-2 text-left transition-all ${
              action === "release_specific"
                ? "border-accent bg-accent/5"
                : "border-border hover:border-muted-foreground"
            }`}
          >
            <CheckCircle className={`w-5 h-5 mb-2 ${action === "release_specific" ? "text-accent" : "text-muted-foreground"}`} />
            <p className="font-semibold text-sm text-foreground">Release Part</p>
            <p className="text-xs text-muted-foreground">Release a specific amount</p>
          </button>
        </div>
      </div>

      {/* Specific amount */}
      <AnimatePresence>
        {action === "release_specific" && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Amount to release (₦)</label>
              <Input
                type="number"
                min={1000}
                max={receiptAmount}
                placeholder="Min ₦1,000"
                value={proposedAmount}
                onChange={(e) => setProposedAmount(e.target.value)}
                className="h-12 text-lg font-semibold"
                required
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Reason */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground">Tell us what happened</label>
        <Textarea
          placeholder="Describe the issue clearly..."
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          required
          rows={3}
        />
      </div>

      {/* Evidence upload */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground">Evidence (optional but recommended)</label>
        <div className="flex gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            className="flex-1"
          >
            <Upload className="w-4 h-4" /> Upload Photo
          </Button>
          <Button type="button" variant="outline" className="flex-1">
            <Camera className="w-4 h-4" /> Take Photo
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          onChange={handleFileChange}
          className="hidden"
        />

        {/* Preview grid */}
        {previews.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {previews.map((url, i) => (
              <div key={i} className="relative aspect-square rounded-lg overflow-hidden bg-muted">
                <img src={url} alt={`Evidence ${i + 1}`} className="w-full h-full object-cover" />
                <button
                  type="button"
                  onClick={() => removeFile(i)}
                  className="absolute top-1 right-1 w-6 h-6 rounded-full bg-destructive flex items-center justify-center"
                >
                  <X className="w-3 h-3 text-destructive-foreground" />
                </button>
                <span className="absolute bottom-1 left-1 bg-foreground/70 text-background text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-0.5">
                  <Image className="w-2.5 h-2.5" /> file
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex gap-3 pt-2">
        <Button type="button" variant="outline" size="lg" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="destructive" size="lg" className="flex-1">
          Start Dispute (₦{getSpamFee().toLocaleString()})
        </Button>
      </div>
    </motion.form>
  );
};

export default DisputeForm;
