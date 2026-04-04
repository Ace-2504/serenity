import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { requireRequestRole } from "@/lib/auth";
import { deleteCloudinaryImageByUrl, isCloudinaryUrl, uploadImageToCloudinary } from "@/lib/cloudinary";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

const MAX_GALLERY_IMAGES = 10;

function isSupportedGalleryUrl(value: unknown): value is string {
  return typeof value === "string" && (value.startsWith("/") || isCloudinaryUrl(value));
}

function normalizeGallery(attributesJson: unknown): string[] {
  const attrs = (attributesJson && typeof attributesJson === "object") ? (attributesJson as Record<string, unknown>) : {};
  const raw = attrs.gallery;
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter(isSupportedGalleryUrl).slice(0, MAX_GALLERY_IMAGES);
}

function mergeAttributes(attributesJson: unknown, gallery: string[]): Prisma.InputJsonValue {
  const attrs = (attributesJson && typeof attributesJson === "object") ? (attributesJson as Record<string, unknown>) : {};
  return {
    ...attrs,
    gallery
  } as Prisma.InputJsonValue;
}

function toSafeFilename(base: string): string {
  return base.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
}

async function getVariantOrNull(variantId: string) {
  return prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true }
  });
}

export async function GET(request: NextRequest, { params }: { params: { variantId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variantId = String(params.variantId ?? "").trim();
  if (!variantId) {
    return NextResponse.json({ message: "Variant id is required." }, { status: 400 });
  }

  const variant = await getVariantOrNull(variantId);
  if (!variant) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }

  return NextResponse.json({
    gallery: normalizeGallery(variant.attributesJson)
  });
}

export async function POST(request: NextRequest, { params }: { params: { variantId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variantId = String(params.variantId ?? "").trim();
  if (!variantId) {
    return NextResponse.json({ message: "Variant id is required." }, { status: 400 });
  }

  const variant = await getVariantOrNull(variantId);
  if (!variant) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }

  const form = await request.formData();
  const imageFiles = form.getAll("images").filter((item): item is File => item instanceof File && item.size > 0);

  if (imageFiles.length === 0) {
    return NextResponse.json({ message: "At least one image file is required." }, { status: 400 });
  }

  const currentGallery = normalizeGallery(variant.attributesJson);
  if (currentGallery.length + imageFiles.length > MAX_GALLERY_IMAGES) {
    return NextResponse.json({ message: `A product gallery can contain at most ${MAX_GALLERY_IMAGES} images.` }, { status: 400 });
  }

  const safeSlug = toSafeFilename(variant.product.slug || variant.product.id) || variant.product.id;
  const folder = `stationery/products/${safeSlug}`;

  const uploadedUrls: string[] = [];

  for (const file of imageFiles) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const publicId = `${Date.now()}-${randomUUID().slice(0, 8)}-${toSafeFilename(file.name.replace(/\.[^.]+$/, "")) || "image"}`;
    const uploaded = await uploadImageToCloudinary({
      bytes,
      folder,
      publicId
    });
    uploadedUrls.push(uploaded.secureUrl);
  }

  const nextGallery = [...currentGallery, ...uploadedUrls];

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      attributesJson: mergeAttributes(variant.attributesJson, nextGallery)
    }
  });

  return NextResponse.json({
    message: "Images uploaded successfully.",
    gallery: nextGallery
  });
}

export async function PATCH(request: NextRequest, { params }: { params: { variantId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variantId = String(params.variantId ?? "").trim();
  if (!variantId) {
    return NextResponse.json({ message: "Variant id is required." }, { status: 400 });
  }

  const variant = await getVariantOrNull(variantId);
  if (!variant) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }

  const body = await request.json().catch(() => ({}));
  const incomingGallery = Array.isArray(body.gallery)
    ? (body.gallery as unknown[]).filter(isSupportedGalleryUrl)
    : null;

  if (!incomingGallery) {
    return NextResponse.json({ message: "gallery must be an array of image URLs." }, { status: 400 });
  }

  if (incomingGallery.length > MAX_GALLERY_IMAGES) {
    return NextResponse.json({ message: `A product gallery can contain at most ${MAX_GALLERY_IMAGES} images.` }, { status: 400 });
  }

  const currentGallery = normalizeGallery(variant.attributesJson);
  const sortedIncoming = [...incomingGallery].sort();
  const sortedCurrent = [...currentGallery].sort();
  if (sortedIncoming.length !== sortedCurrent.length || sortedIncoming.some((url, index) => url !== sortedCurrent[index])) {
    return NextResponse.json({ message: "Gallery reorder can only use existing images." }, { status: 400 });
  }

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      attributesJson: mergeAttributes(variant.attributesJson, incomingGallery)
    }
  });

  return NextResponse.json({
    message: "Gallery order updated.",
    gallery: incomingGallery
  });
}

export async function DELETE(request: NextRequest, { params }: { params: { variantId: string } }) {
  const session = requireRequestRole(request, ["owner_admin", "catalog_manager"]);
  if (!session) {
    return NextResponse.json({ message: "Unauthorized" }, { status: 401 });
  }

  const variantId = String(params.variantId ?? "").trim();
  if (!variantId) {
    return NextResponse.json({ message: "Variant id is required." }, { status: 400 });
  }

  const body = await request.json().catch(() => ({}));
  const imageUrl = String(body.imageUrl ?? "").trim();

  if (!isSupportedGalleryUrl(imageUrl)) {
    return NextResponse.json({ message: "Valid imageUrl is required." }, { status: 400 });
  }

  const variant = await getVariantOrNull(variantId);
  if (!variant) {
    return NextResponse.json({ message: "Variant not found." }, { status: 404 });
  }

  const currentGallery = normalizeGallery(variant.attributesJson);
  const nextGallery = currentGallery.filter((url) => url !== imageUrl);

  await prisma.productVariant.update({
    where: { id: variantId },
    data: {
      attributesJson: mergeAttributes(variant.attributesJson, nextGallery)
    }
  });

  if (isCloudinaryUrl(imageUrl)) {
    await deleteCloudinaryImageByUrl(imageUrl);
  }

  return NextResponse.json({
    message: "Image removed.",
    gallery: nextGallery
  });
}
