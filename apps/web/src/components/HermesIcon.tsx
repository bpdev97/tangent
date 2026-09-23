// Tangent(FORK-HERMES-001): Hermes Agent provider mark.
import type { Icon } from "./Icons";

export const HermesIcon: Icon = (props) => (
  <svg {...props} viewBox="0 0 24 24" fill="none">
    <path
      d="M12 2.25 20.25 7v10L12 21.75 3.75 17V7L12 2.25Z"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinejoin="round"
    />
    <path
      d="M8.25 7.5v9m7.5-9v9m-7.5-4.5h7.5"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
    />
  </svg>
);
