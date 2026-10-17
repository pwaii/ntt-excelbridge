export interface paths {
    "/v1/jobs": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** List Jobs */
        get: operations["list_jobs_v1_jobs_get"];
        put?: never;
        /**
         * Create Job
         * @description Create metadata and return short-lived upload URLs for workbook inputs.
         */
        post: operations["create_job_v1_jobs_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Get Job */
        get: operations["get_job_v1_jobs__job_id__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/start": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Start Job
         * @description Run the AWS-backed pass-through pipeline for the uploaded workbook.
         */
        post: operations["start_job_v1_jobs__job_id__start_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/workbooks/{slot}/metadata": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Metadata */
        get: operations["metadata_v1_jobs__job_id__workbooks__slot__metadata_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/configuration": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        /** Save Configuration */
        put: operations["save_configuration_v1_jobs__job_id__configuration_put"];
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/uploads/file/{slot}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /**
         * Upload Workbook
         * @description Accept an XLSX multipart upload and store it in S3.
         *
         *     This route is convenient for local development and a simple frontend. The
         *     presigned PUT flow remains preferred for production because the workbook
         *     body bypasses the API server entirely.
         */
        post: operations["upload_workbook_v1_jobs__job_id__uploads_file__slot__post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/uploads/complete": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Complete Upload */
        post: operations["complete_upload_v1_jobs__job_id__uploads_complete_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/artifacts/{artifact_type}": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Download Artifact */
        get: operations["download_artifact_v1_jobs__job_id__artifacts__artifact_type__get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/v1/jobs/{job_id}/reviews": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        get?: never;
        put?: never;
        /** Submit Review */
        post: operations["submit_review_v1_jobs__job_id__reviews_post"];
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
    "/health": {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        /** Health */
        get: operations["health_health_get"];
        put?: never;
        post?: never;
        delete?: never;
        options?: never;
        head?: never;
        patch?: never;
        trace?: never;
    };
}
export type webhooks = Record<string, never>;
export interface components {
    schemas: {
        /** Body_upload_workbook_v1_jobs__job_id__uploads_file__slot__post */
        Body_upload_workbook_v1_jobs__job_id__uploads_file__slot__post: {
            /** File */
            file: string;
        };
        /** CreateJobRequest */
        CreateJobRequest: {
            config: components["schemas"]["JobConfig"];
            /** Input Filename */
            input_filename: string;
            /** Main Filename */
            main_filename?: string | null;
        };
        /** CreateJobResponse */
        CreateJobResponse: {
            job: components["schemas"]["JobRecord"];
            /** Request Id */
            request_id: string;
            /** Uploads */
            uploads: components["schemas"]["PresignedUpload"][];
        };
        /** HTTPValidationError */
        HTTPValidationError: {
            /** Detail */
            detail?: components["schemas"]["ValidationError"][];
        };
        /** JobConfig */
        JobConfig: {
            /** Comment Name */
            comment_name: string;
            /** Output Header */
            output_header?: string | null;
            /**
             * Standardize
             * @default false
             */
            standardize: boolean;
            /**
             * Update
             * @default false
             */
            update: boolean;
            /** Input Sheet */
            input_sheet?: string | null;
            /** Main Sheet */
            main_sheet?: string | null;
            /** Key Column */
            key_column?: string | null;
            /** Input Header Row */
            input_header_row?: number | null;
            /** Main Header Row */
            main_header_row?: number | null;
            /** Main Key Column */
            main_key_column?: string | null;
        };
        /** JobListResponse */
        JobListResponse: {
            /** Jobs */
            jobs: components["schemas"]["JobRecord"][];
            /** Request Id */
            request_id: string;
        };
        /**
         * JobRecord
         * @description Typed view of the DynamoDB META item.
         */
        JobRecord: {
            /** Job Id */
            job_id: string;
            /** Owner Id */
            owner_id: string;
            status: components["schemas"]["JobStatus"];
            /** Revision */
            revision: number;
            config: components["schemas"]["JobConfig"];
            /**
             * Configuration Confirmed
             * @default false
             */
            configuration_confirmed: boolean;
            /** Workbook Selections */
            workbook_selections?: {
                [key: string]: components["schemas"]["WorkbookSelection"];
            };
            /** Files */
            files?: {
                [key: string]: components["schemas"]["StoredFile"];
            };
            /** Artifacts */
            artifacts?: {
                [key: string]: {
                    [key: string]: unknown;
                };
            };
            /** Input Hash */
            input_hash?: string | null;
            /** Main Hash */
            main_hash?: string | null;
            /** Output Hash */
            output_hash?: string | null;
            /**
             * Created At
             * Format: date-time
             */
            created_at: string;
            /**
             * Updated At
             * Format: date-time
             */
            updated_at: string;
            /** Expires At */
            expires_at?: number | null;
        };
        /** JobResponse */
        JobResponse: {
            job: components["schemas"]["JobRecord"];
            /** Request Id */
            request_id: string;
        };
        /**
         * JobStatus
         * @enum {string}
         */
        JobStatus: "DRAFT" | "UPLOADING" | "UPLOADED" | "INSPECTING" | "DETECTED" | "SEMANTIC_REVIEW_PENDING" | "QUALITY_REVIEW_PENDING" | "NORMALIZATION_PENDING" | "FORMULA_REVIEW_PENDING" | "STANDARDIZATION_PENDING" | "UPDATE_PENDING" | "TRANSFORMATION_REVIEW_PENDING" | "APPLYING" | "VALIDATING_OUTPUT" | "COMPLETED" | "FAILED" | "CANCELLED" | "COST_GUARD_REACHED";
        /** PresignedDownload */
        PresignedDownload: {
            /** Artifact Type */
            artifact_type: string;
            /** Key */
            key: string;
            /** Url */
            url: string;
            /** Expires In */
            expires_in: number;
            /** Request Id */
            request_id: string;
        };
        /** PresignedUpload */
        PresignedUpload: {
            /** Slot */
            slot: string;
            /** Filename */
            filename: string;
            /** Key */
            key: string;
            /** Url */
            url: string;
            /** Expires In */
            expires_in: number;
        };
        /**
         * ReviewDecision
         * @enum {string}
         */
        ReviewDecision: "accept" | "reject" | "edit" | "ignore";
        /** ReviewItemDecision */
        ReviewItemDecision: {
            decision: components["schemas"]["ReviewDecision"];
            /** Edited Value */
            edited_value?: string | null;
            /** Reason */
            reason?: string | null;
        };
        /** ReviewRequest */
        ReviewRequest: {
            /** Expected Revision */
            expected_revision: number;
            /** Decisions */
            decisions: {
                [key: string]: components["schemas"]["ReviewItemDecision"];
            };
            /** Approved By */
            approved_by?: string | null;
        };
        /** ReviewResponse */
        ReviewResponse: {
            job: components["schemas"]["JobRecord"];
            /** Request Id */
            request_id: string;
            /** Review Id */
            review_id: string;
        };
        /** SaveWorkbookConfiguration */
        SaveWorkbookConfiguration: {
            /** Expected Revision */
            expected_revision: number;
            /** Selections */
            selections: {
                [key: string]: components["schemas"]["WorkbookSelection"];
            };
        };
        /**
         * StoredFile
         * @description The safe subset of an uploaded S3 object kept in the job record.
         */
        StoredFile: {
            /** Filename */
            filename: string;
            /** Key */
            key: string;
            /** Content Type */
            content_type?: string | null;
            /** Size Bytes */
            size_bytes?: number | null;
            /** Etag */
            etag?: string | null;
            /**
             * Uploaded
             * @default false
             */
            uploaded: boolean;
        };
        /** UploadCompleteRequest */
        UploadCompleteRequest: {
            /**
             * Slot
             * @enum {string}
             */
            slot: "input" | "main";
            /** Sha256 */
            sha256?: string | null;
        };
        /** UploadCompleteResponse */
        UploadCompleteResponse: {
            job: components["schemas"]["JobRecord"];
            /** Request Id */
            request_id: string;
            /** Uploaded Slot */
            uploaded_slot: string;
        };
        /** ValidationError */
        ValidationError: {
            /** Location */
            loc: (string | number)[];
            /** Message */
            msg: string;
            /** Error Type */
            type: string;
            /** Input */
            input?: unknown;
            /** Context */
            ctx?: Record<string, never>;
        };
        /** WorkbookColumn */
        WorkbookColumn: {
            /** Id */
            id: string;
            /** Label */
            label: string;
        };
        /** WorkbookMetadataResponse */
        WorkbookMetadataResponse: {
            /** Job Id */
            job_id: string;
            /**
             * Slot
             * @enum {string}
             */
            slot: "input" | "main";
            /** Workbook Version */
            workbook_version: string;
            /** Size Bytes */
            size_bytes: number;
            /**
             * Header Min
             * @default 1
             */
            header_min: number;
            /**
             * Header Max
             * @default 20
             */
            header_max: number;
            /**
             * Index Base
             * @default 1
             * @constant
             */
            index_base: 1;
            /** Key Required */
            key_required: boolean;
            /** Sheets */
            sheets: components["schemas"]["WorksheetMetadata"][];
            /** Request Id */
            request_id: string;
        };
        /** WorkbookSelection */
        WorkbookSelection: {
            /** Sheet Name */
            sheet_name: string;
            /** Header Row */
            header_row: number;
            /**
             * Header Confirmed
             * @constant
             */
            header_confirmed: true;
            /** Key Column */
            key_column?: string | null;
            /** Workbook Version */
            workbook_version: string;
        };
        /** WorksheetMetadata */
        WorksheetMetadata: {
            /** Name */
            name: string;
            /** Detected Header Row */
            detected_header_row: number | null;
            /** Header Row */
            header_row: number | null;
            /** Data Row Count */
            data_row_count: number;
            /** Columns */
            columns: components["schemas"]["WorkbookColumn"][];
            /** Errors */
            errors?: string[];
        };
    };
    responses: never;
    parameters: never;
    requestBodies: never;
    headers: never;
    pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
    list_jobs_v1_jobs_get: {
        parameters: {
            query?: {
                limit?: number;
            };
            header?: {
                "x-user-id"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobListResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    create_job_v1_jobs_post: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path?: never;
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["CreateJobRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            201: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["CreateJobResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    get_job_v1_jobs__job_id__get: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    start_job_v1_jobs__job_id__start_post: {
        parameters: {
            query?: {
                expected_revision?: number | null;
            };
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    metadata_v1_jobs__job_id__workbooks__slot__metadata_get: {
        parameters: {
            query?: {
                sheet_name?: string | null;
                header_row?: number | null;
            };
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
                slot: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["WorkbookMetadataResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    save_configuration_v1_jobs__job_id__configuration_put: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["SaveWorkbookConfiguration"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["JobResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    upload_workbook_v1_jobs__job_id__uploads_file__slot__post: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
                slot: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "multipart/form-data": components["schemas"]["Body_upload_workbook_v1_jobs__job_id__uploads_file__slot__post"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadCompleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    complete_upload_v1_jobs__job_id__uploads_complete_post: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["UploadCompleteRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["UploadCompleteResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    download_artifact_v1_jobs__job_id__artifacts__artifact_type__get: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
                artifact_type: string;
            };
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["PresignedDownload"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    submit_review_v1_jobs__job_id__reviews_post: {
        parameters: {
            query?: never;
            header?: {
                "x-user-id"?: string | null;
            };
            path: {
                job_id: string;
            };
            cookie?: never;
        };
        requestBody: {
            content: {
                "application/json": components["schemas"]["ReviewRequest"];
            };
        };
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["ReviewResponse"];
                };
            };
            /** @description Validation Error */
            422: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": components["schemas"]["HTTPValidationError"];
                };
            };
        };
    };
    health_health_get: {
        parameters: {
            query?: never;
            header?: never;
            path?: never;
            cookie?: never;
        };
        requestBody?: never;
        responses: {
            /** @description Successful Response */
            200: {
                headers: {
                    [name: string]: unknown;
                };
                content: {
                    "application/json": {
                        [key: string]: unknown;
                    };
                };
            };
        };
    };
}
