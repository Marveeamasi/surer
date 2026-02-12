import { Shield } from "lucide-react";
import { Link } from "react-router-dom";

const Footer = () => (
  <footer className="bg-secondary py-12 border-t border-border">
    <div className="container mx-auto px-4">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
        <div>
          <Link to="/" className="flex items-center gap-2 mb-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-hero flex items-center justify-center">
              <Shield className="w-4 h-4 text-primary-foreground" />
            </div>
            <span className="font-display text-lg font-bold">Surer</span>
          </Link>
          <p className="text-sm text-muted-foreground">
            Escrow for everyday payments. Simple. Safe. In your control.
          </p>
        </div>
        <div>
          <h4 className="font-display font-semibold mb-3 text-foreground">Product</h4>
          <div className="flex flex-col gap-2">
            <Link to="/how-it-works" className="text-sm text-muted-foreground hover:text-foreground transition-colors">How it Works</Link>
            <Link to="/pricing" className="text-sm text-muted-foreground hover:text-foreground transition-colors">Pricing</Link>
          </div>
        </div>
        <div>
          <h4 className="font-display font-semibold mb-3 text-foreground">Support</h4>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">help@surer.ng</span>
            <span className="text-sm text-muted-foreground">FAQ</span>
          </div>
        </div>
        <div>
          <h4 className="font-display font-semibold mb-3 text-foreground">Legal</h4>
          <div className="flex flex-col gap-2">
            <span className="text-sm text-muted-foreground">Terms of Service</span>
            <span className="text-sm text-muted-foreground">Privacy Policy</span>
          </div>
        </div>
      </div>
      <div className="mt-10 pt-6 border-t border-border text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Surer. Built on Payscrow infrastructure.
      </div>
    </div>
  </footer>
);

export default Footer;
