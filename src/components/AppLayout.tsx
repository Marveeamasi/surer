import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import BottomNav from "@/components/BottomNav";
import { ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

interface AppLayoutProps {
  children: ReactNode;
  showNav?: boolean;
  showFooter?: boolean;
  showBottomNav?: boolean;
}

const AppLayout = ({ children, showNav = true, showFooter = false, showBottomNav = false }: AppLayoutProps) => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      {showNav && <Navbar />}
      <main className={showBottomNav ? "pb-20 md:pb-0" : ""}>
        {children}
      </main>
      {showFooter && <Footer />}
      {showBottomNav && user && <BottomNav />}
    </div>
  );
};

export default AppLayout;
