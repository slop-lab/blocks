FROM docker:29.1.3-dind-rootless

USER root
COPY entrypoint.sh /usr/local/bin/dim-rootless-dind-entrypoint
RUN chown root:root /usr/bin/newuidmap /usr/bin/newgidmap \
 && chmod 4755 /usr/bin/newuidmap /usr/bin/newgidmap \
 && chmod 0755 /usr/local/bin/dim-rootless-dind-entrypoint

ENTRYPOINT ["/usr/local/bin/dim-rootless-dind-entrypoint"]
