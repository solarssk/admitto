import type { EmailProviderCapabilities } from "./types.js";

export const GRAPH_CAPABILITIES: EmailProviderCapabilities = {
  supportsAttachments: false,
  supportsCustomHeaders: false,
  supportsSentItems: true,
  supportsDeliveryEvents: false,
  supportsBounceMailbox: false,
  supportsEnvelopeFrom: false,
  supportsTestConnection: true,
  deliveryResultSemantics: "accepted_only",
};

export const SMTP_CAPABILITIES: EmailProviderCapabilities = {
  supportsAttachments: true,
  supportsCustomHeaders: true,
  supportsSentItems: false,
  supportsDeliveryEvents: false,
  supportsBounceMailbox: false,
  supportsEnvelopeFrom: true,
  supportsTestConnection: true,
  deliveryResultSemantics: "accepted_only",
};

export const POWER_AUTOMATE_CAPABILITIES: EmailProviderCapabilities = {
  supportsAttachments: false,
  supportsCustomHeaders: false,
  supportsSentItems: false,
  supportsDeliveryEvents: false,
  supportsBounceMailbox: false,
  supportsEnvelopeFrom: false,
  supportsTestConnection: false,
  deliveryResultSemantics: "accepted_only",
};

export const EXPORT_ONLY_CAPABILITIES: EmailProviderCapabilities = {
  supportsAttachments: false,
  supportsCustomHeaders: false,
  supportsSentItems: false,
  supportsDeliveryEvents: false,
  supportsBounceMailbox: false,
  supportsEnvelopeFrom: false,
  supportsTestConnection: true,
  deliveryResultSemantics: "accepted_only",
};

export const MOCK_CAPABILITIES: EmailProviderCapabilities = {
  supportsAttachments: true,
  supportsCustomHeaders: true,
  supportsSentItems: false,
  supportsDeliveryEvents: false,
  supportsBounceMailbox: false,
  supportsEnvelopeFrom: true,
  supportsTestConnection: true,
  deliveryResultSemantics: "accepted_only",
};
