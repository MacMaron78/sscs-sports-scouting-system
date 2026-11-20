from django.db import migrations, models


def ensure_is_read_column(apps, schema_editor):
    table_name = apps.get_model("core", "Message")._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "is_read" not in columns:
        quote_name = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote_name(table_name)} "
            f"ADD COLUMN {quote_name('is_read')} boolean NOT NULL DEFAULT FALSE"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0004_add_agency_contact_phone"),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(
                    ensure_is_read_column,
                    migrations.RunPython.noop,
                ),
            ],
            state_operations=[
                migrations.AddField(
                    model_name="message",
                    name="is_read",
                    field=models.BooleanField(default=False),
                ),
            ],
        ),
    ]
