import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";

export type TotpQrCodeProps = {
  /** `otpauth://` URI returned by the TOTP enrollment API. */
  uri: string;
  onRenderFailed?: () => void;
  onRenderSuccess?: () => void;
};

/** Renders a TOTP enrollment QR code on canvas for authenticator apps. */
export function TotpQrCode({ uri, onRenderFailed, onRenderSuccess }: TotpQrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [renderFailed, setRenderFailed] = useState(false);
  const onRenderFailedRef = useRef(onRenderFailed);
  const onRenderSuccessRef = useRef(onRenderSuccess);
  onRenderFailedRef.current = onRenderFailed;
  onRenderSuccessRef.current = onRenderSuccess;

  useEffect(() => {
    setRenderFailed(false);
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, uri, {
      width: 160,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    })
      .then(() => {
        onRenderSuccessRef.current?.();
      })
      .catch(() => {
        setRenderFailed(true);
        onRenderFailedRef.current?.();
      });
  }, [uri]);

  return (
    <div className="account-totp-qr">
      {renderFailed ? (
        <p className="account-totp-qr__error" role="alert">
          Could not render QR code. Use the raw URI below to set up your authenticator.
        </p>
      ) : (
        <canvas ref={canvasRef} aria-label="TOTP QR code — scan with authenticator app" />
      )}
    </div>
  );
}
