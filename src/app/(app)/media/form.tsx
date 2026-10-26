"use client";
import * as React from "react";
import { ActionForm, Field, SelectField, TextareaField, CheckboxField, FormActions, SubmitButton } from "@/components/forms/action-form";
import { Label } from "@/components/ui/input";
import { saveAssetAction } from "@/app/actions/media";
import { CATEGORY_META } from "@/lib/categories";

type Opt = { value: string; label: string };
export type AssetInitial = Partial<Record<string, string | number | boolean | string[] | null>>;

export function AssetForm({ id, initial, channels, advertisers, campaigns }: { id: string | null; initial: AssetInitial; channels: Opt[]; advertisers: Opt[]; campaigns: Opt[] }) {
  const [cat, setCat] = React.useState(String(initial.category ?? "PROGRAM"));
  const v = (k: string) => (initial[k] == null ? undefined : String(initial[k]));
  const permitted = (initial.permittedChannelIds as string[] | undefined) ?? [];
  return (
    <ActionForm action={saveAssetAction.bind(null, id)} redirectTo={(d) => `/media/item/${(d as { id: string }).id}`}>
      <div className="grid gap-3 md:grid-cols-3">
        <SelectField name="category" label="Category" options={Object.entries(CATEGORY_META).map(([k, m]) => ({ value: k, label: m.label }))} value={cat} onChange={(e) => setCat(e.target.value)} disabled={!!id} />
        {id && <input type="hidden" name="category" value={cat} />}
        <Field name="assetCode" label="House number / asset ID" defaultValue={v("assetCode")} placeholder="PRG-0101" />
        <Field name="duration" label="Duration" defaultValue={v("duration")} placeholder="00:30 or 1:00:00" hint="HH:MM:SS, MM:SS or seconds" />
      </div>
      <Field name="title" label="Title" defaultValue={v("title")} />
      <TextareaField name="description" label="Description" rows={2} defaultValue={v("description")} />
      <div className="grid gap-3 md:grid-cols-3">
        <Field name="fileRef" label="Media file reference" defaultValue={v("fileRef")} placeholder="ams://… or file path" hint="A changed file or duration creates a new version." />
        <Field name="language" label="Language" defaultValue={v("language")} />
        <Field name="contentCategory" label="Content category" defaultValue={v("contentCategory")} placeholder="e.g. KIDS, NEWS, ALCOHOL" hint="Used by category restriction rules." />
      </div>

      {cat === "PROGRAM" && (
        <div className="grid gap-3 md:grid-cols-5">
          <Field name="genre" label="Genre" defaultValue={v("genre")} />
          <Field name="season" label="Season" type="number" defaultValue={v("season")} />
          <Field name="episode" label="Episode" type="number" defaultValue={v("episode")} />
          <Field name="contentRating" label="Rating" defaultValue={v("contentRating")} />
          <div className="pt-6">
            <CheckboxField name="isLive" label="Live" defaultChecked={!!initial.isLive} />
          </div>
        </div>
      )}
      {cat === "MOVIE" && (
        <div className="grid gap-3 md:grid-cols-3">
          <Field name="director" label="Director" defaultValue={v("director")} />
          <Field name="releaseYear" label="Release year" type="number" defaultValue={v("releaseYear")} />
          <Field name="certificate" label="Certificate" defaultValue={v("certificate")} />
        </div>
      )}
      {cat === "COMMERCIAL" && (
        <div className="grid gap-3 md:grid-cols-3">
          <SelectField name="advertiserId" label="Advertiser (client)" placeholder="Choose advertiser" options={advertisers} defaultValue={v("advertiserId")} />
          <Field name="brand" label="Brand" defaultValue={v("brand")} />
          <Field name="productCategory" label="Product category" defaultValue={v("productCategory")} placeholder="e.g. SOFT_DRINKS" hint="Competing commercials share a category." />
          <Field name="clockNumber" label="Clock number" defaultValue={v("clockNumber")} />
          <Field name="agencyRef" label="Agency reference" defaultValue={v("agencyRef")} />
        </div>
      )}
      {cat === "PROMO" && (
        <div className="grid gap-3 md:grid-cols-2">
          <SelectField name="campaignId" label="Promo campaign" placeholder="Not in a campaign" options={campaigns} defaultValue={v("campaignId")} />
          <Field name="promotedTitle" label="Promoted title" defaultValue={v("promotedTitle")} />
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <Field name="rightsOwner" label="Rights owner" defaultValue={v("rightsOwner")} />
        <Field name="maxPlays" label="Max plays (optional)" type="number" defaultValue={v("maxPlays")} hint="Leave blank if unlimited or controlled by a licence." />
      </div>
      <div>
        <Label>Permitted channels</Label>
        <p className="mb-1 text-xs text-muted">None ticked means every channel.</p>
        <div className="flex flex-wrap gap-3 text-sm">
          {channels.map((c) => (
            <label key={c.value} className="flex items-center gap-1.5">
              <input type="checkbox" name="permittedChannelIds" value={c.value} defaultChecked={permitted.includes(c.value)} /> {c.label}
            </label>
          ))}
        </div>
      </div>
      {id && <Field name="versionNotes" label="Version notes (if the file or duration changed)" />}
      <FormActions>
        <SubmitButton>{id ? "Save changes" : "Create asset"}</SubmitButton>
      </FormActions>
    </ActionForm>
  );
}
