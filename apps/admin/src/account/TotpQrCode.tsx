import { useEffect, useRef } from "react";
import QRCode from "qrcode";

export type TotpQrCodeProps = {
  uri: string;
};

/** Renders a TOTP enrollment QR code on canvas for authenticator apps. */
export function TotpQrCode({ uri }: TotpQrCodeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, uri, {
      width: 200,
      margin: 2,
      color: { dark: "#0f172a", light: "#ffffff" },
    }).catch(() => {
      /* canvas stays blank; raw URI remains in details */
    });
  }, [uri]);

  return (
    <div className="account-totp-qr">
      <canvas ref={canvasRef} aria-label="TOTP QR code — scan with authenticator app" />
    </div>
  );
}
