FROM httpd:2.4-bookworm
RUN sed -i 's/#LoadModule dav_module/LoadModule dav_module/; s/#LoadModule dav_fs_module/LoadModule dav_fs_module/; s/#LoadModule auth_digest_module/LoadModule auth_digest_module/' /usr/local/apache2/conf/httpd.conf \
    && mkdir -p /var/lib/dav/data /var/lib/dav/locks \
    && chown -R www-data:www-data /var/lib/dav \
    && htpasswd -bc /usr/local/apache2/conf/dav.password local local-test-token
COPY docker/netcup/webdav.conf /usr/local/apache2/conf/extra/webdav.conf
RUN echo 'Include conf/extra/webdav.conf' >> /usr/local/apache2/conf/httpd.conf
