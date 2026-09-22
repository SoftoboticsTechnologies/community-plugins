import {
    ActionBarItem,
    Button,
    DetailFormGrid,
    ErrorPage,
    FormFieldWrapper,
    NumberInput,
    Page,
    PageActionBar,
    PageBlock,
    PageLayout,
    PageTitle,
    StringListInput,
    Switch,
    useDetailPage,
} from '@vendure/dashboard';
import { toast } from 'sonner';
import { auditLogSettingsDocument, updateAuditLogSettingsDocument } from './audit-log-settings.graphql';

const pageId = 'audit-log-settings';

export function AuditLogSettingsPage() {
    const { form, submitHandler, entity, isPending } = useDetailPage({
        queryDocument: auditLogSettingsDocument,
        entityName: 'AuditLogSettings',
        updateDocument: updateAuditLogSettingsDocument,
        pageId,
        setValuesForUpdate: settings => ({
            retentionDays: settings.retentionDays,
            captureIpAddress: settings.captureIpAddress,
            captureUserAgent: settings.captureUserAgent,
            redactSensitiveFields: settings.redactSensitiveFields,
            extraRedactedKeys: settings.extraRedactedKeys,
        }),
        params: { id: 'undefined' },
        onSuccess: () => {
            toast('Successfully updated audit log settings');
            form.reset(form.getValues());
        },
        onError: err => {
            toast('Failed to update audit log settings', {
                description: err instanceof Error ? err.message : 'Unknown error',
            });
        },
    });

    if (!entity) {
        return <ErrorPage />;
    }

    return (
        <Page pageId={pageId} form={form} submitHandler={submitHandler} entity={entity}>
            <PageTitle>Audit Log Settings</PageTitle>
            <PageActionBar>
                <ActionBarItem itemId="save-button" requiresPermission={['ManageAuditLogSettings']}>
                    <Button
                        type="submit"
                        disabled={!form.formState.isDirty || !form.formState.isValid || isPending}
                    >
                        Update
                    </Button>
                </ActionBarItem>
            </PageActionBar>
            <PageLayout>
                <PageBlock column="main" blockId="main-form">
                    <DetailFormGrid>
                        <FormFieldWrapper
                            control={form.control}
                            name="retentionDays"
                            label="Retention period (days)"
                            description="Audit log entries older than this are deleted by the daily retention task. Set to 0 to keep entries indefinitely."
                            render={({ field }) => <NumberInput {...field} />}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="captureIpAddress"
                            label="Capture IP address"
                            render={({ field }) => (
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="captureUserAgent"
                            label="Capture user agent"
                            render={({ field }) => (
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="redactSensitiveFields"
                            label="Redact sensitive fields"
                            description="Replaces well-known sensitive keys (passwords, tokens, secrets, etc.) with [REDACTED] inside captured diffs."
                            render={({ field }) => (
                                <Switch checked={field.value} onCheckedChange={field.onChange} />
                            )}
                        />
                        <FormFieldWrapper
                            control={form.control}
                            name="extraRedactedKeys"
                            label="Extra redacted keys"
                            description="Additional field names (case-insensitive) to redact, on top of the built-in list."
                            render={({ field }) => (
                                <StringListInput value={field.value ?? []} onChange={field.onChange} />
                            )}
                        />
                    </DetailFormGrid>
                </PageBlock>
            </PageLayout>
        </Page>
    );
}
