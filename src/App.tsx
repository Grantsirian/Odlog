import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, FormEvent } from "react";
import {
  Camera,
  Check,
  ChevronRight,
  Download,
  Gauge,
  History,
  LoaderCircle,
  MapPin,
  Plus,
  ScanLine,
  Trash2,
} from "lucide-react";
import { createWorker, PSM } from "tesseract.js";
import "./App.css";

type CheckpointKind =
  | "office-start"
  | "client-arrival"
  | "client-finish"
  | "office-return";
type Checkpoint = {
  kind: CheckpointKind;
  reading: string;
  capturedAt: string;
  latitude?: number;
  longitude?: number;
  accuracy?: number;
};
type Trip = {
  id: string;
  client: string;
  checkpoints: Checkpoint[];
  completedAt: string;
};
const checkpointLabels: Record<
  CheckpointKind,
  { title: string; detail: string }
> = {
  "office-start": {
    title: "Leave office",
    detail: "Starting odometer and time",
  },
  "client-arrival": {
    title: "Arrive at client",
    detail: "Arrival odometer and time",
  },
  "client-finish": {
    title: "Finish at client",
    detail: "Departure odometer and time",
  },
  "office-return": {
    title: "Return to office",
    detail: "Final odometer and time",
  },
};
const checkpointOrder: CheckpointKind[] = [
  "office-start",
  "client-arrival",
  "client-finish",
  "office-return",
];
const clients = [
  "Northside Dental",
  "Marlow & Co",
  "Greenfield Primary",
  "Add a new client...",
];
const seed: Trip[] = [
  {
    id: "seed-1",
    client: "Northside Dental",
    completedAt: "2026-08-28T10:02:00.000Z",
    checkpoints: checkpointOrder.map((kind, index) => ({
      kind,
      reading: ["24812", "24831", "24832", "24847"][index],
      capturedAt: `2026-08-28T0${9 + Math.floor(index / 2)}:${index ? "31" : "14"}:00.000Z`,
      latitude: -33.8688,
      longitude: 151.2093,
      accuracy: 18,
    })),
  },
];

async function preprocessImage(image: Blob) {
  const bitmap = await createImageBitmap(image);
  const width = 2000;
  const height = Math.round(bitmap.height * (width / bitmap.width));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas is unavailable");
  context.drawImage(bitmap, 0, 0, width, height);
  const pixels = context.getImageData(0, 0, width, height);
  for (let index = 0; index < pixels.data.length; index += 4) {
    const grey =
      pixels.data[index] * 0.299 +
      pixels.data[index + 1] * 0.587 +
      pixels.data[index + 2] * 0.114;
    const contrast = Math.max(0, Math.min(255, (grey - 128) * 1.6 + 128));
    pixels.data[index] = contrast;
    pixels.data[index + 1] = contrast;
    pixels.data[index + 2] = contrast;
  }
  context.putImageData(pixels, 0, 0);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (result) =>
        result
          ? resolve(result)
          : reject(new Error("Image preprocessing failed")),
      "image/png",
    ),
  );
}

function App() {
  const [trips, setTrips] = useState<Trip[]>(() =>
    JSON.parse(localStorage.getItem("odlog-trips") ?? JSON.stringify(seed)),
  );
  const [client, setClient] = useState("");
  const [checkpoints, setCheckpoints] = useState<Checkpoint[]>([]);
  const [capturing, setCapturing] = useState<CheckpointKind | null>(null);
  const [cameraKind, setCameraKind] = useState<CheckpointKind | null>(null)
  const [notice, setNotice] = useState("");
  const captureInput = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null)
  const cameraStream = useRef<MediaStream | null>(null)
  const cameraAvailable = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  useEffect(
    () => localStorage.setItem("odlog-trips", JSON.stringify(trips)),
    [trips],
  );

  const processImage = async (image: Blob, kind: CheckpointKind) => {
    setCapturing(kind);
    setNotice("");
    const checkpoint: Checkpoint = {
      kind,
      reading: "",
      capturedAt: new Date().toISOString(),
    };
    try {
      const worker = await createWorker("eng");
      const processedImage = await preprocessImage(image);
      let best = { confidence: -1, text: "" };
      for (const pageSegmentationMode of [
        PSM.SINGLE_BLOCK,
        PSM.SINGLE_LINE,
        PSM.SINGLE_WORD,
        PSM.RAW_LINE,
      ]) {
        await worker.setParameters({
          tessedit_char_whitelist: "0123456789",
          tessedit_pageseg_mode: pageSegmentationMode,
        });
        const { data } = await worker.recognize(processedImage);
        if (data.confidence > best.confidence)
          best = { confidence: data.confidence, text: data.text };
      }
      await worker.terminate();
      checkpoint.reading = best.text.replace(/[^0-9]/g, "").slice(0, 8);
      if (!checkpoint.reading)
        setNotice("OCR could not find a number. Enter the reading manually.");
    } catch {
      setNotice("OCR could not read this photo. Enter the reading manually.");
    }
    if ("geolocation" in navigator)
      await new Promise<void>((resolve) =>
        navigator.geolocation.getCurrentPosition(
          (position) => {
            checkpoint.latitude = position.coords.latitude;
            checkpoint.longitude = position.coords.longitude;
            checkpoint.accuracy = position.coords.accuracy;
            resolve();
          },
          () => resolve(),
          { enableHighAccuracy: true, timeout: 8000 },
        ),
      );
    setCheckpoints((current) =>
      [...current.filter((item) => item.kind !== kind), checkpoint].sort(
        (a, b) =>
          checkpointOrder.indexOf(a.kind) - checkpointOrder.indexOf(b.kind),
      ),
    );
    setCapturing(null);
  };
  const capture = async (event: ChangeEvent<HTMLInputElement>, kind: CheckpointKind) => {
    const image = event.target.files?.[0];
    if (image) await processImage(image, kind);
    event.target.value = "";
  };
  const openCamera = async (kind: CheckpointKind) => {
    if (!cameraAvailable) { captureInput.current?.click(); return; }
    try {
      cameraStream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
      setCameraKind(kind);
      window.setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = cameraStream.current; }, 0);
    } catch { setNotice("Camera permission was unavailable. Use Add image instead."); }
  };
  const closeCamera = () => { cameraStream.current?.getTracks().forEach((track) => track.stop()); cameraStream.current = null; setCameraKind(null); };
  const takeCameraPhoto = async () => {
    if (!videoRef.current || !cameraKind) return;
    const video = videoRef.current;
    const canvas = document.createElement("canvas"); canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    canvas.getContext("2d")?.drawImage(video, 0, 0);
    const image = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    const kind = cameraKind; closeCamera();
    if (image) await processImage(image, kind);
  };
  const startManual = (kind: CheckpointKind) =>
    setCheckpoints((current) =>
      current.some((item) => item.kind === kind)
        ? current
        : [
            ...current,
            { kind, reading: "", capturedAt: new Date().toISOString() },
          ],
    );
  const updateReading = (kind: CheckpointKind, reading: string) =>
    setCheckpoints((current) =>
      current.map((item) =>
        item.kind === kind
          ? { ...item, reading: reading.replace(/[^0-9]/g, "").slice(0, 8) }
          : item,
      ),
    );
  const beginTrip = () => {
    setClient("");
    setCheckpoints([]);
    setNotice("");
    window.setTimeout(() => openCamera("office-start"), 0);
  };
  const completeTrip = (event: FormEvent) => {
    event.preventDefault();
    if (
      !client ||
      checkpoints.length !== 4 ||
      checkpoints.some((item) => !item.reading)
    )
      return;
    setTrips([
      {
        id: Date.now().toString(),
        client,
        checkpoints,
        completedAt: new Date().toISOString(),
      },
      ...trips,
    ]);
    setClient("");
    setCheckpoints([]);
    setNotice("Trip completed and saved locally.");
  };
  const exportCsv = () => {
    const header = [
      "Client",
      "Office start time",
      "Office start odo",
      "Client arrival time",
      "Client arrival odo",
      "Client finish time",
      "Client finish odo",
      "Office return time",
      "Office return odo",
      "Kilometres driven",
      "GPS locations",
    ];
    const rows = trips.map((trip) => {
      const at = (kind: CheckpointKind) =>
        trip.checkpoints.find((item) => item.kind === kind);
      const start = Number(at("office-start")?.reading);
      const finish = Number(at("office-return")?.reading);
      const gps = trip.checkpoints
        .map((item) =>
          item.latitude
            ? `${item.latitude.toFixed(6)}, ${item.longitude?.toFixed(6)}`
            : "not recorded",
        )
        .join(" | ");
      return [
        trip.client,
        ...checkpointOrder.flatMap((kind) => {
          const point = at(kind);
          return [
            point ? new Date(point.capturedAt).toLocaleString() : "",
            point?.reading ?? "",
          ];
        }),
        Number.isFinite(start) && Number.isFinite(finish)
          ? (finish - start).toFixed(1)
          : "",
        gps,
      ];
    });
    const csv = [header, ...rows]
      .map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(","),
      )
      .join("\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "odlog-trips.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };
  const doneCount = checkpoints.filter((item) => item.reading).length;
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <Gauge size={19} />
          </span>
          <span>odlog</span>
        </div>
        <span className="offline-pill">
          <span /> offline ready
        </span>
      </header>
      <section className="intro">
        <p className="eyebrow">
          TRIP LOG <span>•</span> TODAY
        </p>
        <h1>Capture the journey.</h1>
        <p className="subhead">
          Four moments. One accurate record of time, distance, and place.
        </p>
        <button className="capture-cta" type="button" onClick={beginTrip}>
          <Camera size={19} />{" "}
          Capture a new trip{" "}
          <ChevronRight size={17} />
        </button>
        <input
          ref={captureInput}
          className="visually-hidden"
          type="file"
          accept="image/*"
          onChange={(event) => capture(event, "office-start")}
        />
      </section>
      <form className="capture-panel" onSubmit={completeTrip}>
        <div className="panel-heading">
          <div>
            <p className="eyebrow">NEW TRIP</p>
            <h2>Track a client visit</h2>
          </div>
          <span className="step-badge">{doneCount} / 4 captured</span>
        </div>
        <label className="field-label" htmlFor="client">
          Client or destination
          <select
            id="client"
            value={client}
            onChange={(event) => setClient(event.target.value)}
          >
            <option value="">Select a client...</option>
            {clients.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <div className="checkpoint-list">
          {checkpointOrder.map((kind, index) => {
            const point = checkpoints.find((item) => item.kind === kind);
            const label = checkpointLabels[kind];
            return (
              <div
                className={`checkpoint ${point?.reading ? "complete" : ""}`}
                key={kind}
              >
                <div className="checkpoint-number">
                  {point?.reading ? <Check size={15} /> : `0${index + 1}`}
                </div>
                <div className="checkpoint-copy">
                  <strong>{label.title}</strong>
                  {point ? (
                    <input
                      className="reading-correction"
                      inputMode="numeric"
                      value={point.reading}
                      placeholder="Enter odometer reading"
                      onChange={(event) =>
                        updateReading(kind, event.target.value)
                      }
                    />
                  ) : (
                    <span>{label.detail}</span>
                  )}
                  {point?.latitude && (
                    <small>
                      <MapPin size={12} /> GPS captured ±
                      {Math.round(point.accuracy ?? 0)}m
                    </small>
                  )}
                </div>
                <button type="button" className="scan-button" onClick={() => openCamera(kind)}>
                  {capturing === kind ? (
                    <LoaderCircle className="spin" size={16} />
                  ) : (
                    <Camera size={16} />
                  )}{" "}
                  {capturing === kind
                    ? "Reading..."
                    : point
                      ? "Retake"
                      : cameraAvailable
                        ? "Take photo"
                        : "Add image"}
                </button>
                <label className="manual-button">Add image<input className="visually-hidden" type="file" accept="image/*" onChange={(event) => capture(event, kind)} /></label>
                {!point && (
                  <button
                    type="button"
                    className="manual-button"
                    onClick={() => startManual(kind)}
                  >
                    Manual
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {notice && <p className="notice">{notice}</p>}
        <button
          className="primary-button"
          type="submit"
          disabled={!client || doneCount !== 4}
        >
          <Plus size={18} /> Complete trip <ChevronRight size={17} />
        </button>
      </form>
      <section className="history-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">YOUR RECORD</p>
            <h2>
              Completed trips <span>{trips.length}</span>
            </h2>
          </div>
          <button className="export-button" type="button" onClick={exportCsv}>
            <Download size={16} /> Export CSV
          </button>
        </div>
        <div className="trip-list">
          {trips.map((trip) => {
            const start = Number(trip.checkpoints[0]?.reading);
            const end = Number(trip.checkpoints[3]?.reading);
            return (
              <article className="trip-row" key={trip.id}>
                <div className="trip-icon">
                  <History size={18} />
                </div>
                <div className="trip-content">
                  <strong>{trip.client}</strong>
                  <span>
                    {new Date(
                      trip.checkpoints[0].capturedAt,
                    ).toLocaleDateString()}{" "}
                    • {trip.checkpoints.length} checkpoints
                  </span>
                </div>
                <div className="trip-distance">
                  <strong>{(end - start).toFixed(1)} km</strong>
                  <span>
                    {trip.checkpoints[0].reading} →{" "}
                    {trip.checkpoints[3].reading}
                  </span>
                </div>
                <button
                  className="delete-button"
                  type="button"
                  aria-label={`Delete ${trip.client}`}
                  onClick={() =>
                    setTrips(trips.filter((item) => item.id !== trip.id))
                  }
                >
                  <Trash2 size={15} />
                </button>
              </article>
            );
          })}
        </div>
      </section>
      <footer>
        <ScanLine size={16} /> Photos, timestamps, and GPS stay on this device.
      </footer>
      {cameraKind && <div className="camera-backdrop" role="dialog" aria-modal="true" aria-label="Take odometer photo"><div className="camera-dialog"><div className="camera-header"><strong>Take odometer photo</strong><button type="button" onClick={closeCamera}>Close</button></div><video ref={videoRef} autoPlay playsInline muted /><button type="button" className="shutter-button" onClick={takeCameraPhoto}><Camera size={22} /> Capture photo</button></div></div>}
    </main>
  );
}
export default App;
