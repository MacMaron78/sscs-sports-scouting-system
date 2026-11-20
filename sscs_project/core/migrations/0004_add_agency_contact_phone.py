from django.db import migrations, models


def ensure_contact_phone_column(apps, schema_editor):
    table_name = apps.get_model("core", "AgencyProfile")._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "contact_phone" not in columns:
        quote_name = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote_name(table_name)} "
            f"ADD COLUMN {quote_name('contact_phone')} varchar(32) NOT NULL DEFAULT ''"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0003_align_message_recipient_column"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    ensure_contact_phone_column,
                    migrations.RunPython.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="agencyprofile",
                    name="contact_phone",
                    field=models.CharField(blank=True, default="", max_length=32),
                ),
            ],
        ),
    ]
