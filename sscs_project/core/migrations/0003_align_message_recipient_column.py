from django.db import migrations


def align_recipient_column(apps, schema_editor):
    table_name = apps.get_model("core", "Message")._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "receiver_id" in columns and "recipient_id" not in columns:
        quote_name = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote_name(table_name)} "
            f"RENAME COLUMN {quote_name('receiver_id')} "
            f"TO {quote_name('recipient_id')}"
        )


def reverse_align_recipient_column(apps, schema_editor):
    table_name = apps.get_model("core", "Message")._meta.db_table
    connection = schema_editor.connection

    with connection.cursor() as cursor:
        columns = {
            column.name
            for column in connection.introspection.get_table_description(cursor, table_name)
        }

    if "recipient_id" in columns and "receiver_id" not in columns:
        quote_name = connection.ops.quote_name
        schema_editor.execute(
            f"ALTER TABLE {quote_name(table_name)} "
            f"RENAME COLUMN {quote_name('recipient_id')} "
            f"TO {quote_name('receiver_id')}"
        )


class Migration(migrations.Migration):
    dependencies = [
        ("core", "0002_align_agency_contact_column"),
    ]

    operations = [
        migrations.RunPython(align_recipient_column, reverse_align_recipient_column),
    ]
