import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

// Local shadcn/ui-style primitive; compose links with asChild.
const buttonVariants = cva(
  "ui-button inline-flex max-w-full shrink-0 items-center justify-center gap-2 rounded-md text-[13px] leading-5 font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:bg-secondary disabled:text-muted-foreground disabled:border-transparent [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "button-primary bg-primary text-primary-foreground",
        outline: "button-outline border border-input bg-card text-foreground",
        ghost: "button-ghost text-muted-foreground disabled:bg-transparent",
      },
      size: {
        default: "min-h-9 px-3 py-1.5",
        sm: "min-h-8 px-3 py-1 text-[13px]",
        icon: "size-9 p-2",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Component = asChild ? Slot : "button";
    return (
      <Component
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? type : (type ?? "button")}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
