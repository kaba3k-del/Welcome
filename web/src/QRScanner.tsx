import { useEffect, useRef, useState } from "react";
import jsQR from "jsqr";
export function QRScanner({ onResult }: { onResult: (text: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let stopped = false,
      stream: MediaStream | undefined,
      frame = 0;
    const canvas = document.createElement("canvas"),
      ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    async function scan() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
        if (stopped) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        video.current!.srcObject = stream;
        await video.current!.play();
        const loop = () => {
          if (stopped) return;
          const v = video.current;
          if (v && v.readyState >= 2) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const data = ctx.getImageData(0, 0, canvas.width, canvas.height),
              code = jsQR(data.data, data.width, data.height, {
                inversionAttempts: "dontInvert",
              });
            if (code) {
              stopped = true;
              stream?.getTracks().forEach((t) => t.stop());
              onResult(code.data);
              return;
            }
          }
          frame = requestAnimationFrame(loop);
        };
        loop();
      } catch (e) {
        setError((e as Error).message);
      }
    }
    scan();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  return (
    <div className="qr-scanner">
      <video ref={video} playsInline muted />
      <p className="muted">
        {error ||
          "Наведите камеру на QR-код. Изображение обрабатывается на устройстве."}
      </p>
      <label className="quiet">
        Прочитать QR из изображения
        <input
          type="file"
          accept="image/*"
          onChange={async (e) => {
            try {
              const f = e.target.files?.[0];
              if (!f) return;
              const bitmap = await createImageBitmap(f),
                c = document.createElement("canvas");
              c.width = bitmap.width;
              c.height = bitmap.height;
              const ctx = c.getContext("2d")!;
              ctx.drawImage(bitmap, 0, 0);
              const d = ctx.getImageData(0, 0, c.width, c.height),
                code = jsQR(d.data, d.width, d.height);
              bitmap.close();
              if (!code) throw Error("QR-код не найден");
              onResult(code.data);
            } catch (err) {
              setError((err as Error).message);
            }
          }}
        />
      </label>
    </div>
  );
}
