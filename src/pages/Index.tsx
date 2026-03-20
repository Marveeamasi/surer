import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CheckCircle,
  Smartphone,
  ArrowDownRight,
} from "lucide-react";
import { motion } from "framer-motion";
import heroIllustration from "@/assets/hero.avif";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/contexts/AuthContext";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6 },
};

const steps = [
  {
    number: "01",
    title: "Create a Receipt",
    description: "Enter the amount, description, and receiver's email.",
  },
  {
    number: "02",
    title: "Pay Securely",
    description: "Payment is held safely in escrow. Nobody touches it.",
  },
  {
    number: "03",
    title: "Get Satisfied",
    description: "Once you're happy, release the funds. Or dispute it.",
  },
];

const Index = () => {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-36 md:pb-24">
        <div className="container mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div
              {...fadeUp}
              className="space-y-6 max-md:order-2 max-sm:px-4"
            >
              <h1 className="font-display text-4xl md:text-6xl max-sm:text-center font-extrabold leading-tight text-foreground">
                Pay anyone.{" "}
                <span className="text-gradient-animated">Stay in control.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg max-sm:text-center">
                Safe online payments built for everyday Nigerians: freelancers,
                vendors, artisans, and You.
              </p>
              <div className="flex flex-col sm:flex-row gap-3 flex-wrap">
                <Button variant="hero" size="xl" asChild>
                  <Link to={user? "/create" : "/auth"}>
                    Pay Someone Now <ArrowRight className="w-5 h-5" />
                  </Link>
                </Button>
                <Button variant="hero-outline" size="xl" asChild>
                  <a href="#how-it-works">
                    See How It Works <ArrowDownRight className="w-5 h-5" />
                  </a>
                </Button>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="relative flex items-center justify-center max-md:order-1"
            >
              <div className="inline-flex items-center absolute z-10 mx-2 max-sm:text-center top-5 gap-2 bg-secondary rounded-full px-4 py-1.5 text-sm text-secondary-foreground">
                <Logo size="sm" />
                <span>Loved by thousands across Nigeria</span>
              </div>
              <div className="flex items-center absolute z-20 bottom-5 max-sm:flex-col gap-4 text-sm text-white pt-2">
                <span className="flex items-center gap-1 ">
                  <CheckCircle className="w-4 h-4" /> Protected by Payscrow
                </span>
                <span className="flex items-center gap-1">
                  <CheckCircle className="w-4 h-4" /> Works with Naira
                </span>
              </div>
              <div className="pointer-events-none absolute bottom-0 left-0 right-0 h-24 z-10 rounded-3xl bg-gradient-to-t from-black/60 via-black/20 to-transparent" />
              <img
                src={heroIllustration}
                alt="Surer - Safe payments for Nigerians"
                className="relative rounded-3xl aspect-[3/2] shadow-elevated w-full"
                loading="lazy"
                decoding="async"
              />
            </motion.div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 md:py-24 px-4 bg-secondary">
        <div className="container mx-auto">
          <motion.div {...fadeUp} className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-3">
              Why Nigerians love Surer
            </h2>
          </motion.div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {[
              {
                title: "Without Protection",
                items: [
                  "✗ Money sent, no guarantee",
                  "✗ Scammer keeps your cash",
                  "✗ Hard to get money back",
                  "✗ Stress & lost time",
                ],
                color: "border-border",
              },
              {
                title: "With Surer",
                items: [
                  "✓ Money held in escrow",
                  "✓ Released only on confirmation",
                  "✓ Fair dispute resolution",
                  "✓ Peace of mind guaranteed",
                ],
                color: "border-accent",
              },
            ].map((col, i) => (
              <div
                key={i}
                className={`p-6 rounded-xl border-2 ${
                  i === 1
                    ? "bg-accent/5 border-accent/50"
                    : "bg-destructive/5 border-destructive/50"
                }`}
              >
                <h4 className="font-semibold text-foreground mb-4 text-center sm:text-left">
                  {col.title}
                </h4>
                <ul className="space-y-2 text-sm text-foreground/80">
                  {col.items.map((item, j) => (
                    <li key={j}>{item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="py-16 md:py-24 px-4">
        <div className="container mx-auto">
          <motion.div {...fadeUp} className="text-center mb-12">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-3">
              3 steps. That's it.
            </h2>
          </motion.div>
          <div className="grid md:grid-cols-3 gap-8 max-w-4xl mx-auto">
            {steps.map((s, i) => (
              <motion.div
                key={s.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.15 }}
                className="text-center"
              >
                <div className="text-5xl font-display font-bold text-gradient-hero mb-4">
                  {s.number}
                </div>
                <h3 className="font-display text-xl font-semibold text-foreground mb-2">
                  {s.title}
                </h3>
                <p className="text-muted-foreground text-sm">{s.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Fee transparency */}
      <section className="py-16 md:py-24 px-4 bg-secondary">
        <div className="container mx-auto max-w-2xl">
          <motion.div {...fadeUp} className="text-center mb-8">
            <h2 className="font-display text-3xl md:text-4xl font-bold text-foreground mb-3">
              Just small fee for protecting you money and giving you control
            </h2>
            <p className="text-muted-foreground">No hidden charges. Ever.</p>
          </motion.div>
          <motion.div
            {...fadeUp}
            className="bg-card rounded-2xl shadow-card p-8"
          >
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-border">
                <div>
                  <p className="font-semibold text-foreground">
                    Protection Fee
                  </p>
                  <p className="text-sm text-muted-foreground">
                    Your safety guarantee
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-primary">3.5% + 100</p>
                  <p className="text-xs text-muted-foreground">Max ₦2000</p>
                </div>
              </div>
            </div>
            <div className="mt-6 bg-secondary rounded-xl p-4 text-center">
              <p className="text-sm text-muted-foreground">
                Example: On a ₦100,000 transaction
              </p>
              <p className="font-display text-2xl font-bold text-accent mt-1">
                Just pay: ₦102,000
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 md:py-24 px-4">
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div {...fadeUp} className="space-y-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-hero flex items-center justify-center mx-auto">
              <Smartphone className="w-8 h-8 text-primary-foreground" />
            </div>
            <h2 className="font-display text-3xl md:text-5xl font-bold text-foreground">
              Ready to pay with confidence?
            </h2>
            <p className="text-lg text-muted-foreground max-w-md mx-auto">
              Join thousands of Nigerians who pay safely with Surer. It takes
              less than a minute.
            </p>
            <Button variant="hero" size="xl" asChild>
              <Link to={user? "/create" : "/auth"}>
                Pay Someone Safe
                <ArrowRight className="w-5 h-5" />
              </Link>
            </Button>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Index;
