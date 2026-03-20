import payscrowLogo from "@/assets/partners/payscrow.svg";
import interswitchLogo from "@/assets/partners/interswitch.svg";
import psbLogo from "@/assets/partners/9psb.svg";

const partners = [
  {
    name: "Payscrow",
    image: payscrowLogo,
    alt: "Payscrow Escrow",
    description:
      "the escrow infrastructure that ensures your money is only released when you confirm delivery.",
  },
  {
    name: "Interswitch",
    image: interswitchLogo,
    alt: "Interswitch Payments",
    description:
      "Number one payment processor in Nigeria, for your fast and secure transactions.",
  },
  {
    name: "Transfers to 9PSB bank",
    image: psbLogo,
    alt: "Transfers to 9PSB bank",
    description:
      "For your transfer method to pay someone, transfers are made to 9PSB bank accounts (9 Payment Service Banks)",
  },
];

const Footer = () => (
  <footer className="bg-secondary py-12 border-t border-border">
     {/* Trust & Partners */}
        <div className="mx-auto px-4 container mb-16">
          <div className="flex flex-col items-center text-center gap-8">
            {/* Legal reassurance */}
            <p className="text-muted-foreground/70 max-w-2xl">
              Surer never holds your funds directly. All transactions are
              processed securely by licensed payment partners using
              industry-standard encryption.
            </p>

            {/* Partners */}
            <div className="flex flex-wrap items-start justify-center gap-10">
              {partners.map((partner) => (
                <div
                  key={partner.name}
                  className="flex flex-col items-center gap-3 max-w-[300px]"
                >
                  <img
                    src={partner.image}
                    alt={partner.alt}
                    draggable={false}
                    className="
                      max-h-10 w-24 object-cover
                      opacity-80 grayscale
                      transition-all duration-200
                      hover:opacity-100 hover:grayscale-0
                      dark:opacity-90  dark:grayscale-0
                    "
                    loading="lazy"
                    decoding="async"
                  />

                  <p className="text-muted-foreground">
                    {partner.description}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      <div className="mt-10 pt-6 border-t border-border text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} Surer. Built on Payscrow infrastructure.
      </div>
  </footer>
);

export default Footer;
