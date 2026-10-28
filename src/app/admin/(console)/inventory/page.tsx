"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type MetaOption = {
  id: string;
  name: string;
  slug: string;
};

type InventoryRow = {
  id: string;
  productId: string;
  productSlug: string;
  sku: string;
  priceInr: number;
  compareAtPriceInr: number | null;
  productTitle: string;
  productDescription: string;
  productStatus: string;
  categoryId: string;
  categoryName: string;
  brandId: string;
  brandName: string;
  hsnCode: string;
  gstPercent: number;
  stockOnHand: number;
  lowStockThreshold: number;
  isActive: boolean;
  gallery: string[];
  updatedAt: string;
};

type EditableRow = {
  priceInr: string;
  compareAtPriceInr: string;
  stockOnHand: string;
  lowStockThreshold: string;
};

type ProductEditState = {
  variantId: string;
  productId: string;
  productTitle: string;
  productDescription: string;
  sku: string;
  hsnCode: string;
  gstPercent: string;
  productStatus: "draft" | "published" | "archived";
  categoryId: string;
  brandId: string;
  priceInr: string;
  compareAtPriceInr: string;
  stockOnHand: string;
  lowStockThreshold: string;
  gallery: string[];
};

type FormState = {
  title: string;
  description: string;
  hsnCode: string;
  gstPercent: string;
  categoryId: string;
  brandId: string;
  newCategoryName: string;
  newBrandName: string;
  sku: string;
  priceInr: string;
  compareAtPriceInr: string;
  stockOnHand: string;
  lowStockThreshold: string;
  status: "draft" | "published";
};

const INITIAL_FORM: FormState = {
  title: "",
  description: "",
  hsnCode: "4820",
  gstPercent: "18",
  categoryId: "",
  brandId: "",
  newCategoryName: "",
  newBrandName: "",
  sku: "",
  priceInr: "",
  compareAtPriceInr: "",
  stockOnHand: "",
  lowStockThreshold: "8",
  status: "published"
};

const BULK_CSV_HEADERS = [
  "title",
  "description",
  "hsnCode",
  "gstPercent",
  "sku",
  "priceInr",
  "compareAtPriceInr",
  "stockOnHand",
  "lowStockThreshold",
  "status",
  "categoryId",
  "brandId",
  "categoryName",
  "brandName"
];

const BULK_CSV_SAMPLE_ROW = [
  "A4 Sketchbook 120 GSM",
  "Heavy paper sketchbook for pens and markers",
  "4820",
  "18",
  "SKU-SKETCH-A4-001",
  "499",
  "699",
  "40",
  "8",
  "published",
  "",
  "",
  "Art and Crafts",
  "SketchPro"
];

export default function AdminInventoryPage() {
  const [categories, setCategories] = useState<MetaOption[]>([]);
  const [brands, setBrands] = useState<MetaOption[]>([]);
  const [items, setItems] = useState<InventoryRow[]>([]);
  const [editableRows, setEditableRows] = useState<Record<string, EditableRow>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(INITIAL_FORM);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState<null | { createdCount: number; failedCount: number; errors: Array<{ row: number; sku: string; message: string }> }>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [selectedEdit, setSelectedEdit] = useState<ProductEditState | null>(null);
  const [galleryFiles, setGalleryFiles] = useState<FileList | null>(null);
  const [detailSaving, setDetailSaving] = useState(false);
  const [galleryBusy, setGalleryBusy] = useState(false);
  const [draggedImageUrl, setDraggedImageUrl] = useState<string | null>(null);
  const [dragOverImageUrl, setDragOverImageUrl] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  async function loadData() {
    setLoading(true);
    setError("");

    const [metaResponse, listResponse] = await Promise.all([
      fetch("/api/admin/catalog/meta", { cache: "no-store" }),
      fetch("/api/admin/inventory", { cache: "no-store" })
    ]);

    if (!metaResponse.ok || !listResponse.ok) {
      setError("Unable to load inventory admin data.");
      setLoading(false);
      return;
    }

    const metaData = (await metaResponse.json()) as { categories: MetaOption[]; brands: MetaOption[] };
    const listData = (await listResponse.json()) as { items: InventoryRow[] };

    setCategories(metaData.categories);
    setBrands(metaData.brands);
    setItems(listData.items);
    setEditableRows(
      Object.fromEntries(
        listData.items.map((item) => [
          item.id,
          {
            priceInr: String(item.priceInr),
            compareAtPriceInr: item.compareAtPriceInr ? String(item.compareAtPriceInr) : "",
            stockOnHand: String(item.stockOnHand),
            lowStockThreshold: String(item.lowStockThreshold)
          }
        ])
      )
    );
    setForm((prev) => ({
      ...prev,
      categoryId: prev.categoryId || metaData.categories[0]?.id || "",
      brandId: prev.brandId || metaData.brands[0]?.id || ""
    }));
    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    const response = await fetch("/api/admin/inventory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...form,
        title: form.title.trim(),
        description: form.description.trim(),
        newCategoryName: form.newCategoryName.trim(),
        newBrandName: form.newBrandName.trim(),
        sku: form.sku.trim().toUpperCase(),
        compareAtPriceInr: form.compareAtPriceInr.trim() === "" ? null : form.compareAtPriceInr
      })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to create inventory item.");
      setSaving(false);
      return;
    }

    const payload = (await response.json()) as { item: { productTitle: string; sku: string } };
    setSuccess(`Added ${payload.item.productTitle} (${payload.item.sku}) successfully.`);
    setForm((prev) => ({
      ...INITIAL_FORM,
      categoryId: prev.categoryId,
      brandId: prev.brandId,
      newCategoryName: "",
      newBrandName: ""
    }));
    await loadData();
    setSaving(false);
  }

  async function saveRow(variantId: string) {
    const row = editableRows[variantId];
    if (!row) {
      return;
    }

    setEditingId(variantId);
    setError("");
    setSuccess("");

    const response = await fetch(`/api/admin/inventory/${variantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        priceInr: row.priceInr,
        compareAtPriceInr: row.compareAtPriceInr.trim() === "" ? null : row.compareAtPriceInr,
        stockOnHand: row.stockOnHand,
        lowStockThreshold: row.lowStockThreshold
      })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to update inventory row.");
      setEditingId(null);
      return;
    }

    setSuccess("Inventory row updated.");
    await loadData();
    setEditingId(null);
  }

  function openEditPanel(item: InventoryRow) {
    setSelectedEdit({
      variantId: item.id,
      productId: item.productId,
      productTitle: item.productTitle,
      productDescription: item.productDescription,
      sku: item.sku,
      hsnCode: item.hsnCode,
      gstPercent: String(item.gstPercent),
      productStatus: item.productStatus as "draft" | "published" | "archived",
      categoryId: item.categoryId,
      brandId: item.brandId,
      priceInr: String(item.priceInr),
      compareAtPriceInr: item.compareAtPriceInr ? String(item.compareAtPriceInr) : "",
      stockOnHand: String(item.stockOnHand),
      lowStockThreshold: String(item.lowStockThreshold),
      gallery: item.gallery ?? []
    });
    setDraggedImageUrl(null);
    setDragOverImageUrl(null);
  }

  function reorderGalleryLocally(gallery: string[], fromUrl: string, toUrl: string): string[] {
    const fromIndex = gallery.indexOf(fromUrl);
    const toIndex = gallery.indexOf(toUrl);
    if (fromIndex === -1 || toIndex === -1 || fromIndex === toIndex) {
      return gallery;
    }

    const nextGallery = [...gallery];
    const [moved] = nextGallery.splice(fromIndex, 1);
    nextGallery.splice(toIndex, 0, moved);
    return nextGallery;
  }

  async function saveGalleryOrder(nextGallery: string[]) {
    if (!selectedEdit) {
      return;
    }

    setGalleryBusy(true);
    setError("");
    setSuccess("");

    const response = await fetch(`/api/admin/inventory/${selectedEdit.variantId}/images`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ gallery: nextGallery })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to reorder gallery.");
      setGalleryBusy(false);
      await loadData();
      return;
    }

    const data = (await response.json()) as { gallery: string[] };
    setSelectedEdit((prev) => (prev ? { ...prev, gallery: data.gallery } : prev));
    setSuccess("Gallery order updated. First image is now primary.");
    await loadData();
    setGalleryBusy(false);
  }

  async function saveProductDetails() {
    if (!selectedEdit) {
      return;
    }

    setDetailSaving(true);
    setError("");
    setSuccess("");

    const response = await fetch(`/api/admin/inventory/${selectedEdit.variantId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: selectedEdit.productTitle.trim(),
        description: selectedEdit.productDescription.trim(),
        sku: selectedEdit.sku.trim().toUpperCase(),
        hsnCode: selectedEdit.hsnCode.trim(),
        gstPercent: selectedEdit.gstPercent,
        status: selectedEdit.productStatus,
        categoryId: selectedEdit.categoryId,
        brandId: selectedEdit.brandId,
        priceInr: selectedEdit.priceInr,
        compareAtPriceInr: selectedEdit.compareAtPriceInr.trim() === "" ? null : selectedEdit.compareAtPriceInr,
        stockOnHand: selectedEdit.stockOnHand,
        lowStockThreshold: selectedEdit.lowStockThreshold
      })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to update product details.");
      setDetailSaving(false);
      return;
    }

    setSuccess("Product details updated.");
    await loadData();
    setDetailSaving(false);
  }

  async function uploadGalleryImages() {
    if (!selectedEdit) {
      return;
    }

    if (!galleryFiles || galleryFiles.length === 0) {
      setError("Select at least one image to upload.");
      return;
    }

    const totalAfterUpload = (selectedEdit.gallery?.length ?? 0) + galleryFiles.length;
    if (totalAfterUpload > 10) {
      setError("A product can have at most 10 images.");
      return;
    }

    setGalleryBusy(true);
    setError("");
    setSuccess("");

    const formData = new FormData();
    Array.from(galleryFiles).forEach((file) => formData.append("images", file));

    const response = await fetch(`/api/admin/inventory/${selectedEdit.variantId}/images`, {
      method: "POST",
      body: formData
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to upload images.");
      setGalleryBusy(false);
      return;
    }

    const data = (await response.json()) as { gallery: string[] };
    setSelectedEdit((prev) => (prev ? { ...prev, gallery: data.gallery } : prev));
    setGalleryFiles(null);
    setSuccess("Product images uploaded.");
    await loadData();
    setGalleryBusy(false);
  }

  async function removeGalleryImage(imageUrl: string) {
    if (!selectedEdit) {
      return;
    }

    setGalleryBusy(true);
    setError("");
    setSuccess("");

    const response = await fetch(`/api/admin/inventory/${selectedEdit.variantId}/images`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ imageUrl })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to remove image.");
      setGalleryBusy(false);
      return;
    }

    const data = (await response.json()) as { gallery: string[] };
    setSelectedEdit((prev) => (prev ? { ...prev, gallery: data.gallery } : prev));
    setSuccess("Image removed from gallery.");
    await loadData();
    setGalleryBusy(false);
  }

  async function removeProduct(variantId: string, productTitle: string) {
    const confirmRemove = window.confirm(`Remove ${productTitle} from stock? This will archive the product.`);
    if (!confirmRemove) {
      return;
    }

    setRemovingId(variantId);
    setError("");
    setSuccess("");

    const response = await fetch(`/api/admin/inventory/${variantId}`, {
      method: "DELETE"
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Unable to remove product from stock.");
      setRemovingId(null);
      return;
    }

    setSuccess(`${productTitle} removed from stock.`);
    await loadData();
    setRemovingId(null);
  }

  function parseCsvText(text: string): Array<Record<string, string>> {
    function splitCsvLine(line: string): string[] {
      const cells: string[] = [];
      let current = "";
      let inQuotes = false;

      for (let i = 0; i < line.length; i += 1) {
        const char = line[i];
        const next = line[i + 1];

        if (char === '"') {
          if (inQuotes && next === '"') {
            current += '"';
            i += 1;
          } else {
            inQuotes = !inQuotes;
          }
          continue;
        }

        if (char === "," && !inQuotes) {
          cells.push(current.trim());
          current = "";
          continue;
        }

        current += char;
      }

      cells.push(current.trim());
      return cells;
    }

    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    if (lines.length < 2) {
      return [];
    }

    const headers = splitCsvLine(lines[0]).map((header) => header.trim());
    return lines.slice(1).map((line) => {
      const values = splitCsvLine(line);
      const row: Record<string, string> = {};
      headers.forEach((header, index) => {
        row[header] = values[index] ?? "";
      });
      return row;
    });
  }

  async function uploadBulkCsv() {
    if (!bulkFile) {
      setError("Select a CSV file first.");
      return;
    }

    setBulkBusy(true);
    setError("");
    setSuccess("");
    setBulkResult(null);

    const text = await bulkFile.text();
    const rows = parseCsvText(text);

    if (rows.length === 0) {
      setError("CSV must include header row and at least one data row.");
      setBulkBusy(false);
      return;
    }

    const response = await fetch("/api/admin/inventory/bulk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows })
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { message?: string };
      setError(data.message ?? "Bulk upload failed.");
      setBulkBusy(false);
      return;
    }

    const result = (await response.json()) as {
      createdCount: number;
      failedCount: number;
      errors: Array<{ row: number; sku: string; message: string }>;
    };

    setBulkResult(result);
    setSuccess(`Bulk upload completed. Created ${result.createdCount}, failed ${result.failedCount}.`);
    await loadData();
    setBulkBusy(false);
  }

  function downloadCsv(filename: string, rows: string[][]) {
    const csvText = rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csvText], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return (
    <main className="min-h-screen w-full px-4 pb-16 pt-8 md:px-8 xl:px-12">
      <header className="reveal-in mb-6 flex items-end justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-graphite">Owner Console</p>
          <p className="mt-1 text-[11px] font-semibold uppercase tracking-[0.2em] text-forest">Paper Serenity Stationery Hub</p>
          <h1 className="font-display text-4xl">Inventory Management</h1>
          <p className="mt-1 text-sm text-graphite">Create, edit, or remove products and stock in one place.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/admin" className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas">
            Dashboard
          </Link>
        </div>
      </header>

      {error ? <p className="mb-4 rounded-lg border border-terracotta bg-[#fce7e2] px-3 py-2 text-sm text-terracotta">{error}</p> : null}
      {success ? <p className="mb-4 rounded-lg border border-forest bg-[#ecf8f0] px-3 py-2 text-sm text-forest">{success}</p> : null}

      <section className="reveal-in reveal-delay-1 mb-6 rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f5fbfc] to-paper p-5">
        <h2 className="mb-4 text-xl font-semibold">Add New Inventory Item</h2>
        <form onSubmit={(event) => void onSubmit(event)} className="grid gap-4 md:grid-cols-2">
          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Product Title</span>
            <input
              required
              value={form.title}
              onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Description</span>
            <textarea
              required
              rows={3}
              value={form.description}
              onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Category</span>
            <select
              required
              value={form.categoryId}
              onChange={(event) => setForm((prev) => ({ ...prev, categoryId: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            >
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Or Create New Category</span>
            <input
              placeholder="Example: Art and Crafts"
              value={form.newCategoryName}
              onChange={(event) => setForm((prev) => ({ ...prev, newCategoryName: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Brand</span>
            <select
              required
              value={form.brandId}
              onChange={(event) => setForm((prev) => ({ ...prev, brandId: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            >
              {brands.map((brand) => (
                <option key={brand.id} value={brand.id}>
                  {brand.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Or Create New Brand</span>
            <input
              placeholder="Example: PaperCraft Pro"
              value={form.newBrandName}
              onChange={(event) => setForm((prev) => ({ ...prev, newBrandName: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">SKU</span>
            <input
              required
              value={form.sku}
              onChange={(event) => setForm((prev) => ({ ...prev, sku: event.target.value.toUpperCase() }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Price (INR)</span>
            <input
              required
              type="number"
              min={1}
              value={form.priceInr}
              onChange={(event) => setForm((prev) => ({ ...prev, priceInr: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Compare-at Price (optional)</span>
            <input
              type="number"
              min={1}
              value={form.compareAtPriceInr}
              onChange={(event) => setForm((prev) => ({ ...prev, compareAtPriceInr: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Stock On Hand</span>
            <input
              required
              type="number"
              min={0}
              value={form.stockOnHand}
              onChange={(event) => setForm((prev) => ({ ...prev, stockOnHand: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">Low Stock Threshold</span>
            <input
              required
              type="number"
              min={0}
              value={form.lowStockThreshold}
              onChange={(event) => setForm((prev) => ({ ...prev, lowStockThreshold: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">HSN Code</span>
            <input
              required
              value={form.hsnCode}
              onChange={(event) => setForm((prev) => ({ ...prev, hsnCode: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm font-medium">GST (%)</span>
            <input
              required
              type="number"
              min={0}
              max={50}
              value={form.gstPercent}
              onChange={(event) => setForm((prev) => ({ ...prev, gstPercent: event.target.value }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            />
          </label>

          <label className="block md:col-span-2">
            <span className="mb-1 block text-sm font-medium">Product Status</span>
            <select
              value={form.status}
              onChange={(event) => setForm((prev) => ({ ...prev, status: event.target.value as "draft" | "published" }))}
              className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
            >
              <option value="published">Published</option>
              <option value="draft">Draft</option>
            </select>
          </label>

          <div className="md:col-span-2">
            <button
              type="submit"
              disabled={saving || loading}
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
            >
              {saving ? "Saving..." : "Create Inventory Item"}
            </button>
          </div>
        </form>
      </section>

      <section className="reveal-in reveal-delay-2 mb-6 rounded-2xl border border-mist bg-gradient-to-br from-canvas to-mist-light/60 p-5">
        <h2 className="mb-4 text-xl font-semibold">Bulk CSV Upload</h2>
        <p className="mb-3 text-sm text-graphite">
          Required columns: title,description,hsnCode,gstPercent,sku,priceInr,stockOnHand. Optional: compareAtPriceInr,lowStockThreshold,status,categoryId,brandId,categoryName,brandName.
        </p>

        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(event) => setBulkFile(event.target.files?.[0] ?? null)}
            className="max-w-sm rounded-xl border border-mist bg-canvas px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void uploadBulkCsv()}
            disabled={bulkBusy || loading}
            className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas disabled:opacity-60"
          >
            {bulkBusy ? "Uploading..." : "Upload CSV"}
          </button>
          <button
            type="button"
            onClick={() => downloadCsv("inventory-bulk-template.csv", [BULK_CSV_HEADERS])}
            className="rounded-full border border-mist px-4 py-2 text-sm font-semibold"
          >
            Download Template
          </button>
          <button
            type="button"
            onClick={() => downloadCsv("inventory-bulk-sample.csv", [BULK_CSV_HEADERS, BULK_CSV_SAMPLE_ROW])}
            className="rounded-full border border-mist px-4 py-2 text-sm font-semibold"
          >
            Download Sample
          </button>
        </div>

        {bulkResult ? (
          <div className="mt-4 rounded-xl border border-mist bg-paper p-3 text-sm">
            <p>
              Created: <span className="font-semibold">{bulkResult.createdCount}</span> | Failed: <span className="font-semibold">{bulkResult.failedCount}</span>
            </p>
            {bulkResult.errors.length > 0 ? (
              <ul className="mt-2 space-y-1 text-terracotta">
                {bulkResult.errors.slice(0, 8).map((item) => (
                  <li key={`${item.row}-${item.sku}`}>Row {item.row} ({item.sku || "NO-SKU"}): {item.message}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </section>

      <section className="reveal-in reveal-delay-3 rounded-2xl border border-mist bg-canvas/95 p-5">
        <h2 className="mb-4 text-xl font-semibold">Recent Inventory (Edit Stock and Price)</h2>
        {loading ? <p className="text-sm text-graphite">Loading inventory rows...</p> : null}

        {!loading ? (
          <div className="overflow-auto">
            <table className="w-full min-w-[1080px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-mist text-graphite">
                  <th className="py-2">Product</th>
                  <th className="py-2">SKU</th>
                  <th className="py-2">Category</th>
                  <th className="py-2">Brand</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Price</th>
                  <th className="py-2">Compare</th>
                  <th className="py-2">Stock</th>
                  <th className="py-2">Low Stock</th>
                  <th className="py-2">Updated</th>
                  <th className="py-2">Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item.id} className="border-b border-mist/60">
                    <td className="py-3 font-semibold">{item.productTitle}</td>
                    <td className="py-3">{item.sku}</td>
                    <td className="py-3">{item.categoryName}</td>
                    <td className="py-3">{item.brandName}</td>
                    <td className="py-3 uppercase">{item.productStatus}</td>
                    <td className="py-3">
                      <input
                        type="number"
                        min={1}
                        value={editableRows[item.id]?.priceInr ?? ""}
                        onChange={(event) =>
                          setEditableRows((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...(prev[item.id] ?? {
                                priceInr: "",
                                compareAtPriceInr: "",
                                stockOnHand: "",
                                lowStockThreshold: ""
                              }),
                              priceInr: event.target.value
                            }
                          }))
                        }
                        className="w-24 rounded-lg border border-mist bg-canvas px-2 py-1"
                      />
                    </td>
                    <td className="py-3">
                      <input
                        type="number"
                        min={1}
                        value={editableRows[item.id]?.compareAtPriceInr ?? ""}
                        onChange={(event) =>
                          setEditableRows((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...(prev[item.id] ?? {
                                priceInr: "",
                                compareAtPriceInr: "",
                                stockOnHand: "",
                                lowStockThreshold: ""
                              }),
                              compareAtPriceInr: event.target.value
                            }
                          }))
                        }
                        className="w-24 rounded-lg border border-mist bg-canvas px-2 py-1"
                      />
                    </td>
                    <td className="py-3">
                      <input
                        type="number"
                        min={0}
                        value={editableRows[item.id]?.stockOnHand ?? ""}
                        onChange={(event) =>
                          setEditableRows((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...(prev[item.id] ?? {
                                priceInr: "",
                                compareAtPriceInr: "",
                                stockOnHand: "",
                                lowStockThreshold: ""
                              }),
                              stockOnHand: event.target.value
                            }
                          }))
                        }
                        className="w-20 rounded-lg border border-mist bg-canvas px-2 py-1"
                      />
                    </td>
                    <td className="py-3">
                      <input
                        type="number"
                        min={0}
                        value={editableRows[item.id]?.lowStockThreshold ?? ""}
                        onChange={(event) =>
                          setEditableRows((prev) => ({
                            ...prev,
                            [item.id]: {
                              ...(prev[item.id] ?? {
                                priceInr: "",
                                compareAtPriceInr: "",
                                stockOnHand: "",
                                lowStockThreshold: ""
                              }),
                              lowStockThreshold: event.target.value
                            }
                          }))
                        }
                        className="w-20 rounded-lg border border-mist bg-canvas px-2 py-1"
                      />
                    </td>
                    <td className="py-3">{new Date(item.updatedAt).toLocaleString()}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => openEditPanel(item)}
                          className="rounded-full border border-mist px-3 py-1.5 text-xs font-semibold text-graphite hover:border-ink hover:text-ink"
                        >
                          Edit Details
                        </button>
                        <button
                          type="button"
                          onClick={() => void saveRow(item.id)}
                          disabled={editingId === item.id || removingId === item.id}
                          className="rounded-full border border-ink px-3 py-1.5 text-xs font-semibold hover:border-forest hover:bg-forest hover:text-canvas disabled:opacity-60"
                        >
                          {editingId === item.id ? "Saving..." : "Save"}
                        </button>
                        <button
                          type="button"
                          onClick={() => void removeProduct(item.id, item.productTitle)}
                          disabled={removingId === item.id || editingId === item.id}
                          className="rounded-full border border-terracotta px-3 py-1.5 text-xs font-semibold text-terracotta hover:bg-terracotta hover:text-canvas disabled:opacity-60"
                        >
                          {removingId === item.id ? "Removing..." : "Remove Product"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      {selectedEdit ? (
        <section className="mt-6 rounded-2xl border border-mist bg-gradient-to-br from-canvas via-[#f5fbfc] to-paper p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-xl font-semibold">Edit Product Details</h2>
            <button
              type="button"
              onClick={() => setSelectedEdit(null)}
              className="rounded-full border border-mist px-3 py-1.5 text-xs font-semibold"
            >
              Close
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-medium">Product Name</span>
              <input
                value={selectedEdit.productTitle}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, productTitle: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block md:col-span-2">
              <span className="mb-1 block text-sm font-medium">Description</span>
              <textarea
                rows={3}
                value={selectedEdit.productDescription}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, productDescription: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">SKU</span>
              <input
                value={selectedEdit.sku}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, sku: event.target.value.toUpperCase() } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Status</span>
              <select
                value={selectedEdit.productStatus}
                onChange={(event) =>
                  setSelectedEdit((prev) =>
                    prev ? { ...prev, productStatus: event.target.value as "draft" | "published" | "archived" } : prev
                  )
                }
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              >
                <option value="published">Published</option>
                <option value="draft">Draft</option>
                <option value="archived">Archived</option>
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Category</span>
              <select
                value={selectedEdit.categoryId}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, categoryId: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Brand</span>
              <select
                value={selectedEdit.brandId}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, brandId: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              >
                {brands.map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">HSN Code</span>
              <input
                value={selectedEdit.hsnCode}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, hsnCode: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">GST (%)</span>
              <input
                type="number"
                min={0}
                max={50}
                value={selectedEdit.gstPercent}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, gstPercent: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Price</span>
              <input
                type="number"
                min={1}
                value={selectedEdit.priceInr}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, priceInr: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Compare-at Price</span>
              <input
                type="number"
                min={1}
                value={selectedEdit.compareAtPriceInr}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, compareAtPriceInr: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Stock On Hand</span>
              <input
                type="number"
                min={0}
                value={selectedEdit.stockOnHand}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, stockOnHand: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-1 block text-sm font-medium">Low Stock Threshold</span>
              <input
                type="number"
                min={0}
                value={selectedEdit.lowStockThreshold}
                onChange={(event) => setSelectedEdit((prev) => (prev ? { ...prev, lowStockThreshold: event.target.value } : prev))}
                className="w-full rounded-xl border border-mist bg-canvas px-3 py-2 outline-none focus:border-ink"
              />
            </label>
          </div>

          <div className="mt-5 rounded-xl border border-mist bg-canvas/70 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-graphite">Product Gallery (1-10 images)</h3>
            <p className="mt-1 text-xs text-graphite">Drag images to reorder. The first image is used as the primary image.</p>

            <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center">
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(event) => setGalleryFiles(event.target.files)}
                className="max-w-sm rounded-xl border border-mist bg-canvas px-3 py-2 text-sm"
              />
              <button
                type="button"
                onClick={() => void uploadGalleryImages()}
                disabled={galleryBusy}
                className="rounded-full border border-ink px-4 py-2 text-sm font-semibold hover:border-forest hover:bg-forest hover:text-canvas disabled:opacity-60"
              >
                {galleryBusy ? "Uploading..." : "Upload Images"}
              </button>
            </div>

            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {selectedEdit.gallery.map((imageUrl, index) => (
                <div
                  key={imageUrl}
                  draggable
                  onDragStart={() => {
                    setDraggedImageUrl(imageUrl);
                    setDragOverImageUrl(imageUrl);
                  }}
                  onDragOver={(event) => {
                    event.preventDefault();
                    if (dragOverImageUrl !== imageUrl) {
                      setDragOverImageUrl(imageUrl);
                    }
                  }}
                  onDrop={() => {
                    if (!draggedImageUrl || draggedImageUrl === imageUrl || galleryBusy) {
                      return;
                    }
                    const current = selectedEdit.gallery;
                    const nextGallery = reorderGalleryLocally(current, draggedImageUrl, imageUrl);
                    if (nextGallery === current) {
                      return;
                    }
                    setSelectedEdit((prev) => (prev ? { ...prev, gallery: nextGallery } : prev));
                    void saveGalleryOrder(nextGallery);
                  }}
                  onDragEnd={() => {
                    setDraggedImageUrl(null);
                    setDragOverImageUrl(null);
                  }}
                  className={`overflow-hidden rounded-xl border bg-paper p-2 ${
                    dragOverImageUrl === imageUrl ? "border-ink" : "border-mist"
                  } ${galleryBusy ? "opacity-70" : ""}`}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${index === 0 ? "bg-forest text-canvas" : "bg-mist text-graphite"}`}>
                      {index === 0 ? "Primary" : `#${index + 1}`}
                    </span>
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-graphite">Drag</span>
                  </div>
                  <div className="relative h-28 overflow-hidden rounded-lg bg-canvas">
                    <img src={imageUrl} alt="Product gallery" className="h-full w-full object-contain" />
                  </div>
                  <button
                    type="button"
                    onClick={() => void removeGalleryImage(imageUrl)}
                    disabled={galleryBusy}
                    className="mt-2 w-full rounded-full border border-terracotta px-2 py-1 text-xs font-semibold text-terracotta hover:bg-terracotta hover:text-canvas disabled:opacity-60"
                  >
                    Remove Image
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 flex items-center gap-3">
            <button
              type="button"
              onClick={() => void saveProductDetails()}
              disabled={detailSaving || galleryBusy}
              className="rounded-full bg-ink px-5 py-2.5 text-sm font-semibold text-canvas hover:bg-forest disabled:opacity-60"
            >
              {detailSaving ? "Saving..." : "Save Product Details"}
            </button>
            <p className="text-xs text-graphite">This updates all product fields, price, stock, and tax details.</p>
          </div>
        </section>
      ) : null}
    </main>
  );
}
