import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import { Button } from "@/components/ui/button";
import { Link } from "react-router-dom";
import { Shield, Zap, Users, MessageSquare, ArrowRight, CheckCircle, Lock, Smartphone } from "lucide-react";
import { motion } from "framer-motion";
import heroIllustration from "@/assets/hero-illustration.png";

const fadeUp = {
  initial: { opacity: 0, y: 30 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
  transition: { duration: 0.6 },
};

const features = [
  {
    icon: Shield,
    title: "Your Money, Your Rules",
    description: "Funds are held safely until you're 100% satisfied. No surprises, no wahala.",
  },
  {
    icon: MessageSquare,
    title: "Easy Disputes",
    description: "Not happy? Raise a dispute in seconds. We handle the back and forth for you.",
  },
  {
    icon: Zap,
    title: "Instant & Simple",
    description: "Create a payment receipt in under 30 seconds. Even your mama can use it.",
  },
  {
    icon: Users,
    title: "For Everyone",
    description: "Freelancers, vendors, artisans, buyers — anyone can send or receive money safely.",
  },
];

const steps = [
  { number: "01", title: "Create a Receipt", description: "Enter the amount, description, and receiver's email." },
  { number: "02", title: "Pay Securely", description: "Payment is held safely in escrow. Nobody touches it." },
  { number: "03", title: "Get Satisfied", description: "Once you're happy, release the funds. Or dispute it." },
];

const Index = () => {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />

      {/* Hero */}
      <section className="pt-28 pb-16 md:pt-36 md:pb-24 px-4">
        <div className="container mx-auto">
          <div className="grid md:grid-cols-2 gap-12 items-center">
            <motion.div {...fadeUp} className="space-y-6">
              <div className="inline-flex items-center gap-2 bg-secondary rounded-full px-4 py-1.5 text-sm text-secondary-foreground">
                <Lock className="w-3.5 h-3.5" />
                <span>Protected by Payscrow</span>
              </div>
              <h1 className="font-display text-4xl md:text-6xl font-bold leading-tight text-foreground">
                Pay anyone.{" "}
                <span className="text-gradient-hero">Stay in control.</span>
              </h1>
              <p className="text-lg text-muted-foreground max-w-lg">
                Your money is only released when you're satisfied. Safe online payments built for everyday Nigerians — freelancers, vendors, artisans, and you.
              </p>
              <div className="flex flex-col sm:flex-row gap-3">
                <Button variant="hero" size="xl" asChild>
                  <Link to="/auth?mode=signup">
                    Start for Free <ArrowRight className="w-5 h-5" />
                  </Link>
                </Button>
                <Button variant="hero-outline" size="xl" asChild>
                  <Link to="/how-it-works">See How It Works</Link>
                </Button>
              </div>
              <div className="flex items-center gap-4 text-sm text-muted-foreground pt-2">
                <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-accent" /> No hidden fees</span>
                <span className="flex items-center gap-1"><CheckCircle className="w-4 h-4 text-accent" /> Works with Naira</span>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7, delay: 0.2 }}
              className="relative"
            >
              <div className="absolute inset-0 bg-gradient-hero rounded-3xl opacity-10 blur-3xl" />
              <img
                src={heroIllustration}
                alt="Surer - Safe payments for Nigerians"
                className="relative rounded-3xl shadow-elevated w-full"
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
            <p className="text-muted-foreground max-w-md mx-auto">
              We made escrow so simple, you don't even need to know what escrow means.
            </p>
          </motion.div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {features.map((f, i) => (
              <motion.div
                key={f.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="bg-card rounded-2xl p-6 shadow-card hover:shadow-elevated transition-shadow duration-300"
              >
                <div className="w-12 h-12 rounded-xl bg-gradient-hero flex items-center justify-center mb-4">
                  <f.icon className="w-6 h-6 text-primary-foreground" />
                </div>
                <h3 className="font-display font-semibold text-lg mb-2 text-foreground">{f.title}</h3>
                <p className="text-sm text-muted-foreground">{f.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-16 md:py-24 px-4">
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
                <div className="text-5xl font-display font-bold text-gradient-hero mb-4">{s.number}</div>
                <h3 className="font-display text-xl font-semibold text-foreground mb-2">{s.title}</h3>
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
              Clear, honest pricing
            </h2>
            <p className="text-muted-foreground">No hidden charges. Ever.</p>
          </motion.div>
          <motion.div {...fadeUp} className="bg-card rounded-2xl shadow-card p-8">
            <div className="space-y-4">
              <div className="flex justify-between items-center py-3 border-b border-border">
                <div>
                  <p className="font-semibold text-foreground">Protection Fee (Surer)</p>
                  <p className="text-sm text-muted-foreground">Your safety guarantee</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-primary">1.5%</p>
                  <p className="text-xs text-muted-foreground">Max ₦700</p>
                </div>
              </div>
              <div className="flex justify-between items-center py-3">
                <div>
                  <p className="font-semibold text-foreground">Processing Fee (Payscrow)</p>
                  <p className="text-sm text-muted-foreground">Secure payment processing</p>
                </div>
                <div className="text-right">
                  <p className="font-display font-bold text-primary">2% + ₦100</p>
                  <p className="text-xs text-muted-foreground">Max ₦1,000</p>
                </div>
              </div>
            </div>
            <div className="mt-6 bg-secondary rounded-xl p-4 text-center">
              <p className="text-sm text-muted-foreground">Example: On a ₦100,000 transaction</p>
              <p className="font-display text-2xl font-bold text-accent mt-1">Total fees: ₦1,700</p>
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
              Join thousands of Nigerians who pay safely with Surer. It takes less than a minute.
            </p>
            <Button variant="hero" size="xl" asChild>
              <Link to="/auth?mode=signup">
                Create Your Account <ArrowRight className="w-5 h-5" />
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
