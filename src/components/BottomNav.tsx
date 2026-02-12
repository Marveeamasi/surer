import { Link, useLocation } from "react-router-dom";
import { Home, Plus, FileText, Settings } from "lucide-react";
import { motion } from "framer-motion";

const navItems = [
  { path: "/dashboard", icon: Home, label: "Home" },
  { path: "/create", icon: Plus, label: "New" },
  { path: "/receipts", icon: FileText, label: "Receipts" },
  { path: "/settings", icon: Settings, label: "Settings" },
];

const BottomNav = () => {
  const location = useLocation();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-card/95 backdrop-blur-md border-t border-border md:hidden safe-area-bottom">
      <div className="flex items-center justify-around h-16 px-2">
        {navItems.map((item) => {
          const isActive = location.pathname === item.path || 
            (item.path === "/receipts" && location.pathname.startsWith("/receipt"));
          return (
            <Link
              key={item.path}
              to={item.path}
              className="relative flex flex-col items-center justify-center gap-0.5 w-16 py-1"
            >
              {isActive && (
                <motion.div
                  layoutId="bottomnav-indicator"
                  className="absolute -top-0.5 w-8 h-0.5 rounded-full bg-gradient-accent"
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <item.icon
                className={`w-5 h-5 transition-colors ${
                  isActive ? "text-accent" : "text-muted-foreground"
                }`}
              />
              <span
                className={`text-[10px] font-medium transition-colors ${
                  isActive ? "text-accent" : "text-muted-foreground"
                }`}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
};

export default BottomNav;
