#!/usr/bin/env python3
"""Create all 16 GRC MySQL tables."""
import pymysql

def main():
    # Connect to MySQL server (no database selected yet)
    conn = pymysql.connect(
        host='13.78.81.86',
        port=18306,
        user='root',
        password='Admin123',
        charset='utf8mb4'
    )
    cursor = conn.cursor()

    # Ensure database exists
    cursor.execute('CREATE DATABASE IF NOT EXISTS `grc-server` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci')
    conn.commit()
    conn.close()

    # Reconnect to grc-server database
    conn = pymysql.connect(
        host='13.78.81.86',
        port=18306,
        user='root',
        password='Admin123',
        database='grc-server',
        charset='utf8mb4'
    )
    cursor = conn.cursor()

    # Drop existing tables in reverse dependency order
    drop_tables = [
        'community_replies',
        'community_topics',
        'telemetry_reports',
        'update_reports',
        'client_releases',
        'evolution_events',
        'asset_reports',
        'capsules',
        'genes',
        'skill_downloads',
        'skill_ratings',
        'skill_versions',
        'skills',
        'nodes',
        'api_keys',
        'users'
    ]

    for t in drop_tables:
        cursor.execute(f'DROP TABLE IF EXISTS `{t}`')
        print(f'  Dropped (if existed): {t}')

    conn.commit()
    print()

    # ===================================================================
    # Table 1: users
    # ===================================================================
    cursor.execute("""
    CREATE TABLE users (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        provider VARCHAR(20) NOT NULL,
        provider_id VARCHAR(255) NOT NULL,
        display_name VARCHAR(255),
        avatar_url TEXT,
        email VARCHAR(255),
        tier VARCHAR(20) NOT NULL DEFAULT 'free',
        promoted_asset_count INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_provider (provider, provider_id),
        INDEX idx_tier (tier),
        INDEX idx_email (email)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: users')

    # ===================================================================
    # Table 2: api_keys
    # ===================================================================
    cursor.execute("""
    CREATE TABLE api_keys (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        user_id CHAR(36) NOT NULL,
        key_hash VARCHAR(64) NOT NULL,
        name VARCHAR(255),
        scopes JSON,
        last_used_at TIMESTAMP NULL,
        expires_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_key_hash (key_hash),
        INDEX idx_user_id (user_id),
        CONSTRAINT fk_apikeys_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: api_keys')

    # ===================================================================
    # Table 3: nodes
    # ===================================================================
    cursor.execute("""
    CREATE TABLE nodes (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        node_id VARCHAR(255) NOT NULL,
        user_id CHAR(36) NULL,
        display_name VARCHAR(255),
        platform VARCHAR(50),
        winclaw_version VARCHAR(50),
        last_heartbeat TIMESTAMP NULL,
        capabilities JSON,
        gene_count INT NOT NULL DEFAULT 0,
        capsule_count INT NOT NULL DEFAULT 0,
        env_fingerprint VARCHAR(64),
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_node_id (node_id),
        INDEX idx_user_id (user_id),
        INDEX idx_last_heartbeat (last_heartbeat),
        CONSTRAINT fk_nodes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: nodes')

    # ===================================================================
    # Table 4: skills
    # ===================================================================
    cursor.execute("""
    CREATE TABLE skills (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        slug VARCHAR(255) NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        author_id CHAR(36) NULL,
        category VARCHAR(100),
        latest_version VARCHAR(50),
        download_count INT NOT NULL DEFAULT 0,
        rating_avg FLOAT NOT NULL DEFAULT 0,
        rating_count INT NOT NULL DEFAULT 0,
        tags JSON,
        is_official TINYINT(1) NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_slug (slug),
        INDEX idx_author_id (author_id),
        INDEX idx_category (category),
        INDEX idx_download_count (download_count),
        INDEX idx_status (status),
        FULLTEXT INDEX ft_name_desc (name, description),
        CONSTRAINT fk_skills_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: skills')

    # ===================================================================
    # Table 5: skill_versions
    # ===================================================================
    cursor.execute("""
    CREATE TABLE skill_versions (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        skill_id CHAR(36) NOT NULL,
        version VARCHAR(50) NOT NULL,
        checksum_sha256 VARCHAR(64),
        tarball_url TEXT,
        tarball_size INT,
        min_winclaw_version VARCHAR(50),
        changelog TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_skill_version (skill_id, version),
        INDEX idx_skill_id (skill_id),
        CONSTRAINT fk_skillver_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: skill_versions')

    # ===================================================================
    # Table 6: skill_ratings
    # ===================================================================
    cursor.execute("""
    CREATE TABLE skill_ratings (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        skill_id CHAR(36) NOT NULL,
        user_id CHAR(36) NOT NULL,
        rating TINYINT NOT NULL,
        review TEXT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_skill_user (skill_id, user_id),
        INDEX idx_skill_id (skill_id),
        INDEX idx_user_id (user_id),
        CONSTRAINT fk_skillrat_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        CONSTRAINT fk_skillrat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: skill_ratings')

    # ===================================================================
    # Table 7: skill_downloads
    # ===================================================================
    cursor.execute("""
    CREATE TABLE skill_downloads (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        skill_id CHAR(36) NOT NULL,
        version VARCHAR(50),
        node_id VARCHAR(255),
        user_id CHAR(36) NULL,
        ip_hash VARCHAR(64),
        downloaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_skill_id (skill_id),
        INDEX idx_downloaded_at (downloaded_at),
        INDEX idx_node_id (node_id),
        CONSTRAINT fk_skilldl_skill FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: skill_downloads')

    # ===================================================================
    # Table 8: genes
    # ===================================================================
    cursor.execute("""
    CREATE TABLE genes (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        asset_id VARCHAR(255) NOT NULL,
        node_id VARCHAR(255),
        user_id CHAR(36) NULL,
        category VARCHAR(50),
        signals_match JSON,
        strategy JSON,
        constraints_data JSON,
        validation JSON,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        use_count INT NOT NULL DEFAULT 0,
        success_rate FLOAT NOT NULL DEFAULT 0,
        fail_count INT NOT NULL DEFAULT 0,
        signature VARCHAR(128),
        chain_id VARCHAR(255),
        content_hash VARCHAR(64),
        schema_version INT NOT NULL DEFAULT 1,
        safety_score FLOAT NULL,
        promoted_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_asset_id (asset_id),
        INDEX idx_node_id (node_id),
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_category (category),
        INDEX idx_use_count (use_count),
        INDEX idx_success_rate (success_rate),
        INDEX idx_content_hash (content_hash),
        CONSTRAINT fk_genes_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: genes')

    # ===================================================================
    # Table 9: capsules
    # ===================================================================
    cursor.execute("""
    CREATE TABLE capsules (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        asset_id VARCHAR(255) NOT NULL,
        gene_asset_id VARCHAR(255) NULL,
        node_id VARCHAR(255),
        user_id CHAR(36) NULL,
        trigger_data JSON,
        summary TEXT,
        confidence FLOAT,
        success_streak INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        use_count INT NOT NULL DEFAULT 0,
        signature VARCHAR(128),
        chain_id VARCHAR(255),
        content_hash VARCHAR(64),
        schema_version INT NOT NULL DEFAULT 1,
        safety_score FLOAT NULL,
        promoted_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_asset_id (asset_id),
        INDEX idx_gene_asset_id (gene_asset_id),
        INDEX idx_node_id (node_id),
        INDEX idx_user_id (user_id),
        INDEX idx_status (status),
        INDEX idx_content_hash (content_hash),
        CONSTRAINT fk_capsules_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: capsules')

    # ===================================================================
    # Table 10: asset_reports
    # ===================================================================
    cursor.execute("""
    CREATE TABLE asset_reports (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        asset_id VARCHAR(255) NOT NULL,
        asset_type VARCHAR(10) NOT NULL,
        reporter_node_id VARCHAR(255),
        reporter_user_id CHAR(36) NULL,
        report_type VARCHAR(20) NOT NULL,
        details JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_asset_id (asset_id),
        INDEX idx_report_type (report_type),
        INDEX idx_reporter_node (reporter_node_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: asset_reports')

    # ===================================================================
    # Table 11: evolution_events
    # ===================================================================
    cursor.execute("""
    CREATE TABLE evolution_events (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        event_type VARCHAR(30) NOT NULL,
        asset_id VARCHAR(255),
        asset_type VARCHAR(10),
        node_id VARCHAR(255),
        user_id CHAR(36) NULL,
        details JSON,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_event_type (event_type),
        INDEX idx_asset_id (asset_id),
        INDEX idx_node_id (node_id),
        INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: evolution_events')

    # ===================================================================
    # Table 12: client_releases
    # ===================================================================
    cursor.execute("""
    CREATE TABLE client_releases (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        version VARCHAR(50) NOT NULL,
        channel VARCHAR(20) NOT NULL DEFAULT 'stable',
        platform VARCHAR(20) NOT NULL,
        download_url TEXT,
        checksum_sha256 VARCHAR(64),
        size_bytes BIGINT,
        changelog TEXT,
        min_upgrade_version VARCHAR(50),
        is_critical TINYINT(1) NOT NULL DEFAULT 0,
        published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_version_platform (version, platform, channel),
        INDEX idx_channel (channel),
        INDEX idx_platform (platform),
        INDEX idx_published_at (published_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: client_releases')

    # ===================================================================
    # Table 13: update_reports
    # ===================================================================
    cursor.execute("""
    CREATE TABLE update_reports (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        node_id VARCHAR(255),
        from_version VARCHAR(50),
        to_version VARCHAR(50),
        platform VARCHAR(20),
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        duration_ms INT,
        reported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_node_id (node_id),
        INDEX idx_status (status),
        INDEX idx_to_version (to_version),
        INDEX idx_reported_at (reported_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: update_reports')

    # ===================================================================
    # Table 14: telemetry_reports
    # ===================================================================
    cursor.execute("""
    CREATE TABLE telemetry_reports (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        node_id VARCHAR(255) NOT NULL,
        report_date DATE NOT NULL,
        skill_calls JSON,
        gene_usage JSON,
        capsule_usage JSON,
        platform VARCHAR(50),
        winclaw_version VARCHAR(50),
        session_count INT,
        active_minutes INT,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_node_date (node_id, report_date),
        INDEX idx_report_date (report_date),
        INDEX idx_winclaw_version (winclaw_version)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: telemetry_reports')

    # ===================================================================
    # Table 15: community_topics
    # ===================================================================
    cursor.execute("""
    CREATE TABLE community_topics (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        author_id CHAR(36) NOT NULL,
        title VARCHAR(500) NOT NULL,
        body TEXT NOT NULL,
        category VARCHAR(50),
        tags JSON,
        view_count INT NOT NULL DEFAULT 0,
        reply_count INT NOT NULL DEFAULT 0,
        is_pinned TINYINT(1) NOT NULL DEFAULT 0,
        is_locked TINYINT(1) NOT NULL DEFAULT 0,
        last_reply_at TIMESTAMP NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_author_id (author_id),
        INDEX idx_category (category),
        INDEX idx_created_at (created_at),
        INDEX idx_last_reply_at (last_reply_at),
        FULLTEXT INDEX ft_title_body (title, body),
        CONSTRAINT fk_topics_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: community_topics')

    # ===================================================================
    # Table 16: community_replies
    # ===================================================================
    cursor.execute("""
    CREATE TABLE community_replies (
        id CHAR(36) NOT NULL DEFAULT (UUID()),
        topic_id CHAR(36) NOT NULL,
        author_id CHAR(36) NOT NULL,
        body TEXT NOT NULL,
        is_solution TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        INDEX idx_topic_id (topic_id),
        INDEX idx_author_id (author_id),
        INDEX idx_created_at (created_at),
        CONSTRAINT fk_replies_topic FOREIGN KEY (topic_id) REFERENCES community_topics(id) ON DELETE CASCADE,
        CONSTRAINT fk_replies_author FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    """)
    print('  Created: community_replies')

    conn.commit()

    # Verify all tables
    cursor.execute('SHOW TABLES')
    tables = cursor.fetchall()
    print('\n=== All tables in grc-server ===')
    for t in tables:
        print(f'  - {t[0]}')
    print(f'\nTotal: {len(tables)} tables')

    # Show table details
    for t in tables:
        tname = t[0]
        cursor.execute(f'SELECT COUNT(*) FROM `{tname}`')
        count = cursor.fetchone()[0]
        cursor.execute(f'SHOW CREATE TABLE `{tname}`')
        create_stmt = cursor.fetchone()[1]
        engine_info = 'InnoDB' if 'InnoDB' in create_stmt else 'other'
        print(f'  {tname}: {count} rows, {engine_info}')

    conn.close()
    print('\nAll 16 tables created successfully!')


if __name__ == '__main__':
    main()
