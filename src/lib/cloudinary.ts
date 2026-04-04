import { v2 as cloudinary } from "cloudinary";

function getCloudinaryConfig() {
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;

  if (!cloudName || !apiKey || !apiSecret) {
    throw new Error("Cloudinary is not configured.");
  }

  return { cloudName, apiKey, apiSecret };
}

let configured = false;

function ensureCloudinaryConfigured() {
  if (configured) {
    return getCloudinaryConfig();
  }

  const config = getCloudinaryConfig();
  cloudinary.config({
    cloud_name: config.cloudName,
    api_key: config.apiKey,
    api_secret: config.apiSecret,
    secure: true
  });
  configured = true;
  return config;
}

export function isCloudinaryUrl(url: string): boolean {
  return /^https:\/\/res\.cloudinary\.com\//i.test(url);
}

export async function uploadImageToCloudinary(input: {
  bytes: Buffer;
  folder: string;
  publicId: string;
}) {
  ensureCloudinaryConfigured();

  return new Promise<{ secureUrl: string; publicId: string }>((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: input.folder,
        public_id: input.publicId,
        resource_type: "image",
        overwrite: false
      },
      (error, result) => {
        if (error || !result?.secure_url || !result.public_id) {
          reject(error ?? new Error("Cloudinary upload failed."));
          return;
        }

        resolve({
          secureUrl: result.secure_url,
          publicId: result.public_id
        });
      }
    );

    stream.end(input.bytes);
  });
}

export function extractCloudinaryPublicId(url: string): string | null {
  if (!isCloudinaryUrl(url)) {
    return null;
  }

  try {
    const parsed = new URL(url);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const uploadIndex = parts.findIndex((part) => part === "upload");
    if (uploadIndex === -1) {
      return null;
    }

    const publicParts = parts.slice(uploadIndex + 1);
    if (publicParts[0]?.startsWith("v") && /^v\d+$/.test(publicParts[0])) {
      publicParts.shift();
    }

    if (publicParts.length === 0) {
      return null;
    }

    const last = publicParts[publicParts.length - 1] ?? "";
    publicParts[publicParts.length - 1] = last.replace(/\.[a-z0-9]+$/i, "");
    return publicParts.join("/");
  } catch {
    return null;
  }
}

export async function deleteCloudinaryImageByUrl(url: string): Promise<void> {
  ensureCloudinaryConfigured();
  const publicId = extractCloudinaryPublicId(url);
  if (!publicId) {
    return;
  }

  await cloudinary.uploader.destroy(publicId, { resource_type: "image" }).catch(() => undefined);
}
