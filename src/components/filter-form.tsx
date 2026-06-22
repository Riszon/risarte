"use client";

import { useRef } from "react";
import { usePathname, useRouter } from "next/navigation";

/**
 * A GET-style filter form that applies automatically: changing a <select>,
 * checkbox, radio or date input navigates immediately (soft client navigation),
 * so there is no "Filtrar" button. Free-text inputs still submit on Enter.
 * Empty values are dropped from the URL to keep it clean.
 */
export function FilterForm({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const ref = useRef<HTMLFormElement>(null);

  function navigate() {
    if (!ref.current) return;
    const data = new FormData(ref.current);
    const params = new URLSearchParams();
    for (const [key, value] of data.entries()) {
      if (typeof value === "string" && value !== "") params.set(key, value);
    }
    const qs = params.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  function onChange(e: React.ChangeEvent<HTMLFormElement>) {
    const target = e.target as HTMLElement;
    const type = (target as HTMLInputElement).type;
    if (
      target.tagName === "SELECT" ||
      type === "checkbox" ||
      type === "radio" ||
      type === "date"
    ) {
      navigate();
    }
  }

  return (
    <form
      ref={ref}
      className={className}
      onChange={onChange}
      onSubmit={(e) => {
        e.preventDefault();
        navigate();
      }}
    >
      {children}
    </form>
  );
}
