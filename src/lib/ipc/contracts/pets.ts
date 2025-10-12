import { z } from "zod";

const nullableNumber = z.number().nullable();
const optionalNullableNumber = nullableNumber.optional();

const normalizeHousehold = <T extends { householdId?: string; household_id?: string }>(
  value: T,
  ctx: z.RefinementCtx,
): { householdId?: string; household_id: string } => {
  const camel = typeof value.householdId === "string" ? value.householdId : undefined;
  const snake = typeof value.household_id === "string" ? value.household_id : undefined;

  if (!camel && !snake) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "householdId is required" });
    return { household_id: "" };
  }

  if (camel && snake && camel !== snake) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "householdId mismatch" });
  }

  const resolved = snake ?? camel!;
  return { householdId: camel ?? resolved, household_id: resolved };
};

const withHouseholdId = <Schema extends z.ZodRawShape>(
  shape: Schema,
  options: { require?: boolean } = {},
) => {
  const requireHousehold = options.require !== false;
  return z
    .object({
      householdId: z.string().min(1).optional(),
      household_id: z.string().min(1).optional(),
      ...shape,
    })
    .passthrough()
    .superRefine((value, ctx) => {
      if (!requireHousehold && value.householdId == null && value.household_id == null) {
        return;
      }
      const normalized = normalizeHousehold(value, ctx);
      Object.assign(value, normalized);
    });
};

const petImagePathSchema = z.string().min(1).optional().nullable();

export const PetRecordSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    type: z.string(),
    household_id: z.string(),
    image_path: petImagePathSchema,
    created_at: z.number(),
    updated_at: z.number(),
    deleted_at: optionalNullableNumber,
    position: z.number().int(),
  })
  .passthrough();

export const PetsListRequestSchema = withHouseholdId({
  orderBy: z.string().optional(),
  order_by: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  includeDeleted: z.boolean().optional(),
  include_deleted: z.boolean().optional(),
});

export const PetsGetRequestSchema = withHouseholdId({ id: z.string() }, { require: false });

const petCreateDataSchema = z
  .object({
    household_id: z.string(),
    name: z.string().min(1),
    type: z.string().min(1),
    image_path: petImagePathSchema,
    position: z.number().int().nonnegative().optional(),
  })
  .passthrough();

const petUpdateDataSchema = petCreateDataSchema
  .partial({
    household_id: true,
    name: true,
    type: true,
    position: true,
    image_path: true,
  })
  .extend({
    updated_at: z.number().optional(),
    deleted_at: optionalNullableNumber,
    created_at: z.number().optional(),
  })
  .passthrough()
  .refine((value) => Object.keys(value).length > 0, {
    message: "update data must include at least one field",
  });

export const PetsCreateRequestSchema = z
  .object({ data: petCreateDataSchema })
  .passthrough();

export const PetsUpdateRequestSchema = withHouseholdId({
  id: z.string(),
  data: petUpdateDataSchema,
});

export const PetsDeleteRequestSchema = withHouseholdId({ id: z.string() });

export const PetsRestoreRequestSchema = withHouseholdId({ id: z.string() });

export const PetsListResponseSchema = z.array(PetRecordSchema);
export const PetsGetResponseSchema = PetRecordSchema.nullable();
export const PetsCreateResponseSchema = PetRecordSchema;
export const PetsMutationResponseSchema = z.null();

const PetMedicalCategorySchema = z.literal("pet_medical");

export const PetMedicalRecordSchema = z
  .object({
    id: z.string(),
    pet_id: z.string(),
    household_id: z.string(),
    date: z.number(),
    description: z.string(),
    document: z.string().nullable().optional(),
    reminder: optionalNullableNumber,
    created_at: z.number(),
    updated_at: z.number(),
    deleted_at: optionalNullableNumber,
    root_key: z.string().nullable().optional(),
    relative_path: z.string().nullable().optional(),
    category: PetMedicalCategorySchema,
  })
  .passthrough();

const petMedicalListShape = {
  orderBy: z.string().optional(),
  order_by: z.string().optional(),
  limit: z.number().int().nonnegative().optional(),
  offset: z.number().int().nonnegative().optional(),
  includeDeleted: z.boolean().optional(),
  include_deleted: z.boolean().optional(),
  petId: z.string().optional(),
  pet_id: z.string().optional(),
};

export const PetMedicalListRequestSchema = withHouseholdId(petMedicalListShape);
export const PetMedicalGetRequestSchema = withHouseholdId({ id: z.string() }, { require: false });

const ensurePetMedicalCategory = (value: { category?: string | null }, ctx: z.RefinementCtx) => {
  if (value.category == null) {
    value.category = "pet_medical";
    return;
  }
  if (value.category !== "pet_medical") {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "category must be 'pet_medical'" });
  }
};

const petMedicalCreateBase = z
  .object({
    household_id: z.string(),
    pet_id: z.string(),
    date: z.number(),
    description: z.string().min(1),
    document: z.string().nullable().optional(),
    reminder: optionalNullableNumber,
    relative_path: z.string().nullable().optional(),
    root_key: z.string().nullable().optional(),
    category: z.string().optional(),
  })
  .passthrough();

const petMedicalCreateDataSchema = petMedicalCreateBase.superRefine(ensurePetMedicalCategory);

const petMedicalUpdateDataSchema = petMedicalCreateBase
  .partial({
    household_id: true,
    pet_id: true,
    date: true,
    description: true,
    document: true,
    reminder: true,
    relative_path: true,
    root_key: true,
    category: true,
  })
  .extend({ deleted_at: optionalNullableNumber, updated_at: z.number().optional() })
  .superRefine(ensurePetMedicalCategory)
  .refine((value) => Object.keys(value).length > 0, {
    message: "update data must include at least one field",
  });

export const PetMedicalCreateRequestSchema = z
  .object({ data: petMedicalCreateDataSchema })
  .passthrough();

export const PetMedicalUpdateRequestSchema = withHouseholdId({
  id: z.string(),
  data: petMedicalUpdateDataSchema,
});

export const PetMedicalDeleteRequestSchema = withHouseholdId({ id: z.string() });
export const PetMedicalRestoreRequestSchema = withHouseholdId({ id: z.string() });

export const PetMedicalListResponseSchema = z.array(PetMedicalRecordSchema);
export const PetMedicalGetResponseSchema = PetMedicalRecordSchema.nullable();
export const PetMedicalCreateResponseSchema = PetMedicalRecordSchema;
export const PetMedicalMutationResponseSchema = z.null();

export type PetsListRequest = z.input<typeof PetsListRequestSchema>;
export type PetsListResponse = z.output<typeof PetsListResponseSchema>;
export type PetRecord = z.output<typeof PetRecordSchema>;
export type PetMedicalListRequest = z.input<typeof PetMedicalListRequestSchema>;
export type PetMedicalRecord = z.output<typeof PetMedicalRecordSchema>;
