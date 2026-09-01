# Odlog - Odometer Logger

A React-based web application for tracking vehicle trips and odometer readings using optical character recognition (OCR). Capture odometer photos, automatically extract readings, and record trip checkpoints with GPS location data.

## Prerequisites

- Node.js 16+ and npm

## Installation

```bash
npm install
```

## Running the Application

### Development

```bash
npm run dev
```

The application will start at `http://localhost:5173` with hot module reloading (HMR).

### Production Build

```bash
npm run build
```

The optimized build output will be in the `dist/` directory.

### Preview Production Build

```bash
npm run preview
```

## Features

- Capture odometer readings via camera
- Automatic OCR extraction of numeric readings from images
- Track multi-checkpoint trips (office start, client arrival, client finish, office return)
- GPS location recording for each checkpoint
- Download trip data for records
- Trip history management
